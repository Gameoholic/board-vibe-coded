import type { Request, RequestHandler, Response } from "express";
import { Router } from "express";
import type { Account } from "./accounts.js";
import { sessionAccount } from "./authRoutes.js";
import { cancelInvite, makeInvite, openInvites } from "./invites.js";

/**
 * `/api/invites`: making, listing and cancelling invite links. Only for an account that may invite; to any
 * other — or no session at all — these routes answer 404, as if there were nothing here.
 */
export function buildInviteRouter(dir: string): Router {
  const asInviter =
    (handle: (account: Account, req: Request, res: Response) => void): RequestHandler =>
    (req, res) => {
      const account = sessionAccount(dir, req);
      if (!account?.canInvite) {
        res.status(404).json({ error: "not found" });
        return;
      }
      handle(account, req, res);
    };

  const router = Router();

  router.get(
    "/",
    asInviter((account, _req, res) => {
      res.json(openInvites(dir, account));
    }),
  );

  router.post(
    "/",
    asInviter((account, _req, res) => {
      res.status(201).json(makeInvite(dir, account));
    }),
  );

  router.delete(
    "/:id",
    asInviter((account, req, res) => {
      if (cancelInvite(dir, account, String(req.params.id))) res.status(204).end();
      else res.status(404).json({ error: "invite not found" });
    }),
  );

  return router;
}
