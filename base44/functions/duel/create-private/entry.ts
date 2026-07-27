import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { createPrivateDuel } from "../../../shared/duel-service.js";

Deno.serve(async (req) => {
  try { return Response.json(await createPrivateDuel(clientFor(req))); }
  catch (error) { return handleFunctionError(error); }
});
