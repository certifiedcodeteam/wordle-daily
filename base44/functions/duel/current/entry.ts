import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { currentDuel } from "../../../shared/duel-service.js";

Deno.serve(async (req) => {
  try { return Response.json(await currentDuel(clientFor(req))); }
  catch (error) { return handleFunctionError(error); }
});
