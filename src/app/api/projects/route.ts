import { createProject, listProjects } from "@/lib/server/db";
import { jsonError, jsonOk } from "@/lib/server/http";
import { createProjectSchema } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonOk({ projects: listProjects() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createProjectSchema.parse(await request.json());
    const project = createProject(input);
    return jsonOk({ project }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
