import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { forfeitDuel } from "../../../shared/duel-service.js";

Deno.serve(async (req) => {
  try { const { matchId } = await req.json(); return Response.json(await forfeitDuel(clientFor(req), matchId)); }
  catch (error) { return handleFunctionError(error); }
});
