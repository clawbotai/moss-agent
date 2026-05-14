import { Workbench } from "@/components/workbench";

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return <Workbench initialTaskId={taskId} />;
}
