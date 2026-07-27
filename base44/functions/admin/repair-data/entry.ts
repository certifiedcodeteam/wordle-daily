import { clientFor, handleFunctionError, requireUser } from "../../../shared/platform.js";
import { repairDuplicatePlayerData } from "../../../shared/repair-service.js";

const CONFIRMATION = "repair-duplicate-player-data";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed", code: "method_not_allowed" }, { status: 405 });
    const base44 = clientFor(req);
    const user = await requireUser(base44);
    if (user.role !== "admin") throw Object.assign(new Error("Not found"), { status: 404, code: "not_found" });
    const input = await req.json();
    const apply = input?.dryRun === false;
    if (apply && input?.confirmation !== CONFIRMATION) {
      throw Object.assign(new Error("Repair confirmation is required"), { status: 400, code: "confirmation_required" });
    }
    const result = await repairDuplicatePlayerData(base44.asServiceRole.entities, { apply });
    console.log(JSON.stringify({ event: "admin_data_repair", user_id: user.id, ...result }));
    return Response.json({ ...result, confirmationRequired: apply ? undefined : CONFIRMATION });
  } catch (error) {
    return handleFunctionError(error);
  }
});
