/**
 * MJ Internet backend (Google Apps Script web app).
 *
 * Keeps users and orders in the Google Sheet this script is attached to,
 * sends OTP codes and new-order emails, and decides who is an admin.
 * The web page (index.html) never sees password hashes, OTP codes or admin rights:
 * it only sends requests and shows the answers.
 *
 * Setup steps are in README.md ("Backend setup").
 */

// Prices live here, not in the web page, so a customer cannot change them.
var PACKAGES = {
  GB5:  { label: "GB 5",  priceTzs: 6500 },
  GB10: { label: "GB 10", priceTzs: 12000 },
  GB15: { label: "GB 15", priceTzs: 16500 },
  GB20: { label: "GB 20", priceTzs: 22000 },
  GB30: { label: "GB 30", priceTzs: 31000 },
  GB35: { label: "GB 35", priceTzs: 37000 },
  GB40: { label: "GB 40", priceTzs: 42000 }
};

var TIME_ZONE = "Africa/Dar_es_Salaam";
var OTP_TTL_SECONDS = 15 * 60;
var OTP_MAX_ATTEMPTS = 5;
var OTP_RESEND_COOLDOWN_SECONDS = 60;
var SESSION_TTL_SECONDS = 6 * 60 * 60;  // CacheService keeps entries for at most 6 hours
var RESET_TTL_SECONDS = 10 * 60;
var LOGIN_MAX_FAILURES = 5;
var LOGIN_LOCK_SECONDS = 15 * 60;
var HASH_ROUNDS = 1000;
var MAIL_RESERVED_FOR_ORDERS = 5;  // OTP emails stop before the daily quota runs out, so order emails still go
var ORDER_STATUSES = ["pending", "completed", "rejected"];

var USERS_SHEET = "Users";
var USERS_HEADERS = ["email", "name", "salt", "passwordHash", "createdAt"];
var ORDERS_SHEET = "Orders";
var ORDERS_HEADERS = ["orderId", "createdAt", "email", "name", "packageId", "package",
                      "priceTzs", "phone", "paymentRef", "status", "updatedAt"];

var ACTIONS = {
  register: register_,
  login: login_,
  forgot: forgot_,
  resendOtp: resendOtp_,
  verifyOtp: verifyOtp_,
  resetPassword: resetPassword_,
  me: me_,
  logout: logout_,
  placeOrder: placeOrder_,
  myOrders: myOrders_,
  adminData: adminData_,
  adminSetStatus: adminSetStatus_
};


// ---------- Entry points ----------

/** Run once from the Apps Script editor: creates the sheets and the secret PEPPER. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty("PEPPER")) {
    props.setProperty("PEPPER", randomToken_());
  }
  sheet_(USERS_SHEET, USERS_HEADERS);
  sheet_(ORDERS_SHEET, ORDERS_HEADERS);
  if (!props.getProperty("ADMIN_EMAILS")) {
    console.warn("Add the ADMIN_EMAILS script property (Project Settings > Script properties).");
  }
}

/** A simple health check, so opening the web app URL in a browser shows it is alive. */
function doGet() {
  return json_({ ok: true, service: "mj-internet-api" });
}

/** Every request from the web page arrives here as JSON: { action: "...", ...fields }. */
function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || "");
  } catch (err) {
    return json_({ ok: false, error: "bad_request" });
  }

  var result;
  try {
    if (!req || typeof req !== "object" || !has_(ACTIONS, req.action)) fail_("bad_request");
    result = ACTIONS[req.action](req);
    result.ok = true;
  } catch (err) {
    if (err && err.isUserError) {
      result = { ok: false, error: err.code };
    } else {
      console.error(err && err.stack ? err.stack : err);
      result = { ok: false, error: "server_error" };
    }
  }
  return json_(result);
}


// ---------- Accounts ----------

function register_(req) {
  var name = cleanName_(req.name);
  var email = cleanEmail_(req.email);
  var password = cleanPassword_(req.password);
  if (findUser_(email)) fail_("already_registered");

  // The account is only written to the sheet after the email code is confirmed.
  var salt = randomToken_();
  startOtp_(email, "register", name, { name: name, salt: salt, passwordHash: hashPassword_(password, salt) });
  return {};
}

function login_(req) {
  var email = cleanEmail_(req.email);
  var password = String(req.password || "");
  var cache = CacheService.getScriptCache();
  var failKey = key_("fail", email);
  var failures = Number(cache.get(failKey) || 0);
  if (failures >= LOGIN_MAX_FAILURES) fail_("locked");

  var user = findUser_(email);
  // Hash even when the user does not exist, so the response time does not reveal registered emails.
  var hash = hashPassword_(password, user ? user.salt : "no-such-user");
  if (!user || !safeEqual_(hash, String(user.passwordHash))) {
    cache.put(failKey, String(failures + 1), LOGIN_LOCK_SECONDS);
    fail_("invalid_credentials");
  }
  cache.remove(failKey);
  startOtp_(email, "login", user.name, {});
  return {};
}

function forgot_(req) {
  var email = cleanEmail_(req.email);
  var user = findUser_(email);
  if (user) startOtp_(email, "reset", user.name, {});
  // Same answer either way, so this cannot be used to test which emails are registered.
  return {};
}

function resendOtp_(req) {
  var email = cleanEmail_(req.email);
  var purpose = cleanPurpose_(req.purpose);
  var entry = readJson_(CacheService.getScriptCache().get(key_("otp", purpose + ":" + email)));
  if (!entry) {
    if (purpose === "reset") return {};  // see forgot_
    fail_("otp_expired");
  }
  startOtp_(email, purpose, entry.name, entry.payload);
  return {};
}

function verifyOtp_(req) {
  var email = cleanEmail_(req.email);
  var purpose = cleanPurpose_(req.purpose);
  var payload = checkOtp_(email, purpose, String(req.code || "").trim());

  if (purpose === "register") {
    withLock_(function () {
      if (findUser_(email)) fail_("already_registered");
      appendObject_(sheet_(USERS_SHEET, USERS_HEADERS), USERS_HEADERS, {
        email: email, name: payload.name, salt: payload.salt,
        passwordHash: payload.passwordHash, createdAt: nowIso_()
      });
    });
    return newSession_(email);
  }
  if (purpose === "login") return newSession_(email);

  // purpose === "reset": hand out a short-lived token that allows one password change.
  var resetToken = randomToken_();
  CacheService.getScriptCache().put(key_("reset", resetToken), email, RESET_TTL_SECONDS);
  return { resetToken: resetToken };
}

function resetPassword_(req) {
  var cache = CacheService.getScriptCache();
  var resetKey = key_("reset", String(req.resetToken || ""));
  var email = cache.get(resetKey);
  if (!email) fail_("reset_expired");
  var password = cleanPassword_(req.password);

  withLock_(function () {
    var user = findUser_(email);
    if (!user) fail_("reset_expired");
    var salt = randomToken_();
    var saltColumn = USERS_HEADERS.indexOf("salt") + 1;  // passwordHash is the next column
    sheet_(USERS_SHEET, USERS_HEADERS).getRange(user.row, saltColumn, 1, 2)
      .setValues([[cell_(salt), cell_(hashPassword_(password, salt))]]);
  });
  cache.remove(resetKey);
  cache.remove(key_("fail", email));
  return newSession_(email);
}

function me_(req) {
  return { user: publicUser_(requireUser_(req.token)) };
}

function logout_(req) {
  CacheService.getScriptCache().remove(key_("session", String(req.token || "")));
  return {};
}


// ---------- Orders ----------

function placeOrder_(req) {
  var user = requireUser_(req.token);
  var packageId = String(req.packageId || "");
  if (!has_(PACKAGES, packageId)) fail_("invalid_package");
  var pkg = PACKAGES[packageId];
  var phone = cleanPhone_(req.phone);
  var paymentRef = cleanPaymentRef_(req.paymentRef);

  var order = withLock_(function () {
    var sheet = sheet_(ORDERS_SHEET, ORDERS_HEADERS);
    var refUsed = readRows_(sheet, ORDERS_HEADERS).some(function (o) {
      return String(o.paymentRef).toUpperCase() === paymentRef;
    });
    if (refUsed) fail_("duplicate_payment_ref");

    var now = nowIso_();
    var newOrder = {
      orderId: newOrderId_(), createdAt: now, email: user.email, name: user.name,
      packageId: packageId, package: pkg.label, priceTzs: pkg.priceTzs, phone: phone,
      paymentRef: paymentRef, status: "pending", updatedAt: now
    };
    appendObject_(sheet, ORDERS_HEADERS, newOrder);
    return newOrder;
  });

  notifyOwner_(order);
  return { order: publicOrder_(order) };
}

function myOrders_(req) {
  var user = requireUser_(req.token);
  var orders = readRows_(sheet_(ORDERS_SHEET, ORDERS_HEADERS), ORDERS_HEADERS)
    .filter(function (o) { return String(o.email) === user.email; });
  return { orders: newestFirst_(orders).map(publicOrder_) };
}

function adminData_(req) {
  requireAdmin_(req.token);
  var users = readRows_(sheet_(USERS_SHEET, USERS_HEADERS), USERS_HEADERS).map(function (u) {
    return { name: String(u.name), email: String(u.email), createdAt: String(u.createdAt) };
  });
  var orders = readRows_(sheet_(ORDERS_SHEET, ORDERS_HEADERS), ORDERS_HEADERS);
  return { users: users, orders: newestFirst_(orders).map(publicOrder_) };
}

function adminSetStatus_(req) {
  requireAdmin_(req.token);
  var status = String(req.status || "");
  if (ORDER_STATUSES.indexOf(status) === -1) fail_("invalid_status");
  var orderId = String(req.orderId || "");

  withLock_(function () {
    var sheet = sheet_(ORDERS_SHEET, ORDERS_HEADERS);
    var order = readRows_(sheet, ORDERS_HEADERS).filter(function (o) { return String(o.orderId) === orderId; })[0];
    if (!order) fail_("not_found");
    var statusColumn = ORDERS_HEADERS.indexOf("status") + 1;  // updatedAt is the next column
    sheet.getRange(order.row, statusColumn, 1, 2).setValues([[cell_(status), cell_(nowIso_())]]);
  });
  return {};
}


// ---------- OTP codes ----------

/** Creates a new code, emails it, and remembers it (with the payload) for OTP_TTL_SECONDS. */
function startOtp_(email, purpose, name, payload) {
  var cache = CacheService.getScriptCache();
  var cacheKey = key_("otp", purpose + ":" + email);
  var previous = readJson_(cache.get(cacheKey));
  var now = Date.now();
  if (previous && now - previous.sentAt < OTP_RESEND_COOLDOWN_SECONDS * 1000) fail_("resend_wait");

  var code = newOtpCode_();
  sendMail_(email, "MJ Internet code: " + code, otpEmailBody_(name, code), MAIL_RESERVED_FOR_ORDERS);
  var entry = { code: code, attempts: 0, sentAt: now, expiresAt: now + OTP_TTL_SECONDS * 1000,
                name: name, payload: payload };
  cache.put(cacheKey, JSON.stringify(entry), OTP_TTL_SECONDS);
}

/** Returns the stored payload if the code is right; counts wrong guesses and gives up after OTP_MAX_ATTEMPTS. */
function checkOtp_(email, purpose, code) {
  return withLock_(function () {
    var cache = CacheService.getScriptCache();
    var cacheKey = key_("otp", purpose + ":" + email);
    var entry = readJson_(cache.get(cacheKey));
    var now = Date.now();
    if (!entry || now > entry.expiresAt) {
      cache.remove(cacheKey);
      fail_("otp_expired");
    }
    if (!/^\d{6}$/.test(code) || !safeEqual_(code, entry.code)) {
      entry.attempts += 1;
      if (entry.attempts >= OTP_MAX_ATTEMPTS) {
        cache.remove(cacheKey);
        fail_("otp_too_many");
      }
      cache.put(cacheKey, JSON.stringify(entry), Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)));
      fail_("otp_invalid");
    }
    cache.remove(cacheKey);
    return entry.payload;
  });
}

function otpEmailBody_(name, code) {
  return "Hello " + name + ",\n\n" +
    "Your MJ Internet verification code is: " + code + "\n" +
    "It expires in 15 minutes. If you did not ask for this code, ignore this email.\n\n" +
    "---\n\n" +
    "Habari " + name + ",\n\n" +
    "Kodi yako ya uthibitisho ya MJ Internet ni: " + code + "\n" +
    "Inaisha baada ya dakika 15. Kama hukuomba kodi hii, puuza barua pepe hii.\n\n" +
    "MJ Internet";
}


// ---------- Sessions and roles ----------

function newSession_(email) {
  var token = randomToken_();
  CacheService.getScriptCache().put(key_("session", token), email, SESSION_TTL_SECONDS);
  return { token: token, user: publicUser_(findUser_(email)) };
}

function requireUser_(token) {
  var email = CacheService.getScriptCache().get(key_("session", String(token || "")));
  var user = email ? findUser_(email) : null;
  if (!user) fail_("not_logged_in");
  return user;
}

function requireAdmin_(token) {
  var user = requireUser_(token);
  if (!isAdmin_(user.email)) fail_("forbidden");
  return user;
}

/** Admins are the emails listed in the ADMIN_EMAILS script property (comma separated). */
function isAdmin_(email) {
  var admins = String(PropertiesService.getScriptProperties().getProperty("ADMIN_EMAILS") || "")
    .split(",").map(function (a) { return a.trim().toLowerCase(); });
  return admins.indexOf(email) !== -1;
}

function publicUser_(user) {
  var email = String(user.email);
  return { name: String(user.name), email: email, isAdmin: isAdmin_(email) };
}

function publicOrder_(o) {
  return {
    orderId: String(o.orderId), createdAt: String(o.createdAt), email: String(o.email),
    name: String(o.name), package: String(o.package), priceTzs: Number(o.priceTzs),
    phone: String(o.phone), paymentRef: String(o.paymentRef), status: String(o.status)
  };
}


// ---------- Input checks ----------

function cleanEmail_(value) {
  var email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail_("invalid_email");
  return email;
}

function cleanName_(value) {
  var name = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 60) fail_("invalid_name");
  return name;
}

function cleanPassword_(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) fail_("weak_password");
  return value;
}

/** Halotel numbers start with 061 or 062. Accepts 06..., 2556... or +2556... and returns 06... */
function cleanPhone_(value) {
  var phone = String(value || "").replace(/[\s-]/g, "").replace(/^\+?255/, "0");
  if (!/^06[12]\d{7}$/.test(phone)) fail_("invalid_phone");
  return phone;
}

function cleanPaymentRef_(value) {
  var ref = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{4,40}$/.test(ref)) fail_("invalid_payment_ref");
  return ref;
}

function cleanPurpose_(value) {
  if (["register", "login", "reset"].indexOf(value) === -1) fail_("bad_request");
  return value;
}


// ---------- Sheet helpers ----------

function sheet_(name, headers) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Reads all data rows as objects keyed by header, plus .row (the sheet row number). */
function readRows_(sheet, headers) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, headers.length).getValues().map(function (values, i) {
    var row = { row: i + 2 };
    headers.forEach(function (header, j) { row[header] = values[j]; });
    return row;
  });
}

function appendObject_(sheet, headers, obj) {
  sheet.appendRow(headers.map(function (header) { return cell_(obj[header]); }));
}

function findUser_(email) {
  return readRows_(sheet_(USERS_SHEET, USERS_HEADERS), USERS_HEADERS)
    .filter(function (u) { return String(u.email) === email; })[0] || null;
}

/**
 * Text is written with a leading apostrophe so Sheets stores it as plain text:
 * phone numbers keep their leading 0, and a name like "=IMPORTXML(...)" is not run as a formula.
 */
function cell_(value) {
  return typeof value === "string" ? "'" + value : value;
}

function newestFirst_(rows) {
  return rows.slice().sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
}


// ---------- Small utilities ----------

function fail_(code) {
  throw { isUserError: true, code: code };
}

function has_(obj, key) {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(obj, key);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function readJson_(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (err) { return null; }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function nowIso_() {
  return new Date().toISOString();
}

/** Cache keys are hashed so long emails or tokens never exceed the 250-character key limit. */
function key_(prefix, value) {
  return prefix + ":" + toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8));
}

/** Salted, peppered, repeated HMAC-SHA256. PEPPER lives only in Script Properties, never in the sheet. */
function hashPassword_(password, salt) {
  var pepper = PropertiesService.getScriptProperties().getProperty("PEPPER");
  if (!pepper) fail_("server_not_configured");
  var value = salt + ":" + password;
  for (var i = 0; i < HASH_ROUNDS; i++) {
    value = toHex_(Utilities.computeHmacSha256Signature(value, pepper));
  }
  return value;
}

/** Compares two strings in time that does not depend on where they first differ. */
function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex_(bytes) {
  return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, "0"); }).join("");
}

/** 64 hex characters from two random UUIDs. */
function randomToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
}

function newOtpCode_() {
  var n = parseInt(Utilities.getUuid().replace(/-/g, "").slice(0, 12), 16);
  return ("000000" + (n % 1000000)).slice(-6);
}

function newOrderId_() {
  return "ORD-" + Utilities.formatDate(new Date(), TIME_ZONE, "yyyyMMdd") + "-" +
    Utilities.getUuid().replace(/-/g, "").slice(0, 6).toUpperCase();
}

function formatTzs_(amount) {
  return "TZS " + String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function sendMail_(to, subject, body, keepInReserve) {
  if (MailApp.getRemainingDailyQuota() <= (keepInReserve || 0)) fail_("email_failed");
  try {
    MailApp.sendEmail(to, subject, body);
  } catch (err) {
    console.error(err);
    fail_("email_failed");
  }
}

/** Emails the owner about a new order. The order is already saved, so a mail failure is only logged. */
function notifyOwner_(order) {
  var props = PropertiesService.getScriptProperties();
  var owner = props.getProperty("OWNER_EMAIL") || String(props.getProperty("ADMIN_EMAILS") || "").split(",")[0].trim();
  if (!owner) return;
  var body = "New Halotel order / Oda mpya ya Halotel\n\n" +
    "Order ID: " + order.orderId + "\n" +
    "Customer: " + order.name + " <" + order.email + ">\n" +
    "Package: " + order.package + " (" + formatTzs_(order.priceTzs) + ")\n" +
    "Halotel number: " + order.phone + "\n" +
    "Payment transaction ID: " + order.paymentRef + "\n" +
    "Time: " + Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd HH:mm") + "\n\n" +
    "Check the payment, then mark the order Completed or Rejected in the admin panel.";
  try {
    MailApp.sendEmail(owner, "New order " + order.orderId + " - " + order.package, body);
  } catch (err) {
    console.error("Order email failed for " + order.orderId + ": " + err);
  }
}
