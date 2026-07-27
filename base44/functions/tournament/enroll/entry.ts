import { clientFor, handleFunctionError, requireUser } from "../../../shared/platform.js";
import { ensureSeason } from "../../../shared/season-service.js";

Deno.serve(async (req) => {
  try { const base44 = clientFor(req); return Response.json(await ensureSeason(base44, await requireUser(base44))); }
  catch (error) { return handleFunctionError(error); }
});
