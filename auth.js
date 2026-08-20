import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );
}

export function auth(req, res, next) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return res.status(401).json({ error: "Não autenticado" });
  try {
    req.user = jwt.verify(h.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Sessão expirada" });
  }
}

export function allow(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Sem permissão" });
    next();
  };
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}
export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}
