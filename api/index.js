import { handleRequest } from "../server/handler.js";

// Vercel Serverless Function entry. All /api/* routes are rewritten here
// (see vercel.json). Static assets in public/ are served directly by Vercel.
export default function handler(req, res) {
  return handleRequest(req, res);
}
