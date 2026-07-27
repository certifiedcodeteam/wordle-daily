import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { duelStatus } from "../../../shared/duel-service.js";

Deno.serve(async (req) => {
  try { const { matchId } = await req.json(); return Response.json(await duelStatus(clientFor(req), matchId)); }
  catch (error) { return handleFunctionError(error); }
});
