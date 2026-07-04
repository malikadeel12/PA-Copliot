const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { getDb } = require("./db");

const JWT_ALGORITHM = "HS256";
const SIGNUP_FREE_CREDITS = 5;

function hashPassword(password) {
  return bcrypt.hashSync(password, bcrypt.genSaltSync(10));
}

function verifyPassword(plain, hashed) {
  try {
    return bcrypt.compareSync(plain, hashed);
  } catch {
    return false;
  }
}

function createAccessToken(userId, email) {
  return jwt.sign(
    { sub: userId, email, type: "access" },
    process.env.JWT_SECRET,
    { algorithm: JWT_ALGORITHM, expiresIn: "7d" }
  );
}

function decodeAccessToken(token) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    if (payload.type !== "access") return null;
    return payload;
  } catch {
    return null;
  }
}

function publicUser(doc) {
  return {
    user_id: doc.user_id,
    email: doc.email,
    name: doc.name ?? null,
    npi: doc.npi ?? null,
    specialty: doc.specialty ?? null,
    facility_name: doc.facility_name ?? null,
    facility_address: doc.facility_address ?? null,
    signature_data_url: doc.signature_data_url ?? null,
    credits: doc.credits ?? 0,
    auth_provider: doc.auth_provider ?? "password",
    role: doc.role ?? "physician",
  };
}

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== "false",
    sameSite: "none",
    maxAge: maxAgeMs,
    path: "/",
  };
}

function setJwtCookie(res, token) {
  res.cookie("access_token", token, cookieOptions(7 * 24 * 60 * 60 * 1000));
}

function bearerFrom(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

// Accepts JWT access_token OR Emergent session_token (cookie or Bearer).
async function requireAuth(req, res, next) {
  const db = getDb();
  const bearer = bearerFrom(req);

  const jwtToken = req.cookies?.access_token || bearer;
  if (jwtToken) {
    const payload = decodeAccessToken(jwtToken);
    if (payload) {
      const doc = await db.collection("users").findOne({ user_id: payload.sub }, { projection: { _id: 0 } });
      if (doc) {
        req.user = doc;
        return next();
      }
    }
  }

  const sessionToken = req.cookies?.session_token || bearer;
  if (sessionToken) {
    const sess = await db.collection("user_sessions").findOne({ session_token: sessionToken }, { projection: { _id: 0 } });
    if (sess) {
      const exp = new Date(sess.expires_at);
      if (exp >= new Date()) {
        const doc = await db.collection("users").findOne({ user_id: sess.user_id }, { projection: { _id: 0 } });
        if (doc) {
          req.user = doc;
          return next();
        }
      }
    }
  }

  return res.status(401).json({ detail: "Not authenticated" });
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ detail: "Admin access required" });
  }
  return next();
}

module.exports = {
  SIGNUP_FREE_CREDITS,
  hashPassword,
  verifyPassword,
  createAccessToken,
  decodeAccessToken,
  publicUser,
  setJwtCookie,
  cookieOptions,
  requireAuth,
  requireAdmin,
};
