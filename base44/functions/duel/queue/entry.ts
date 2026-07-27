import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { queueDuel } from "../../../shared/duel-service.js";

Deno.serve(async (req) => {
  try { return Response.json(await queueDuel(clientFor(req))); }
  catch (error) { return handleFunctionError(error); }
});
