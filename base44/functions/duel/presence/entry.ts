import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { updateDuelPresence } from "../../../shared/duel-service.js";

Deno.serve(async (req) => {
  try { return Response.json(await updateDuelPresence(clientFor(req), await req.json())); }
  catch (error) { return handleFunctionError(error); }
});
