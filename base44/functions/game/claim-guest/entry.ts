import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { claimGuestDailySession } from "../../../shared/session-service.js";

Deno.serve(async (req) => {
  try { return Response.json(await claimGuestDailySession(clientFor(req), await req.json())); }
  catch (error) { return handleFunctionError(error); }
});
