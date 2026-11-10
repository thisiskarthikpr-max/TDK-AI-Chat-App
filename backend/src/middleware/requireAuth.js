import { verifyAccessToken } from '../lib/tokens.js';

export function requireAuth(req, res, next) {
  const authorization = req.get('authorization') ?? '';
  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = verifyAccessToken(token);
    if (typeof payload.sub !== 'string' || !payload.sub) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.userId = payload.sub;
    return next();
  } catch {
    return res.status(401).json({ error: 'Authentication required' });
  }
}
