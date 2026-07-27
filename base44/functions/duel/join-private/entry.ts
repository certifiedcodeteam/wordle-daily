import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { joinPrivateDuel } from "../../../shared/duel-service.js";

Deno.serve(async (req) => {
  try { const { inviteCode } = await req.json(); return Response.json(await joinPrivateDuel(clientFor(req), inviteCode)); }
  catch (error) { return handleFunctionError(error); }
});
