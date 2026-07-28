import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { updatePartyPresence } from "../../../shared/party-service.js";

Deno.serve(async (req) => {
  try { return Response.json(await updatePartyPresence(clientFor(req), await req.json())); }
  catch (error) { return handleFunctionError(error); }
});
