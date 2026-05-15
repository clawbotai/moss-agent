import type { TaskLog } from "@/lib/types";
import { deriveLogKind, deriveLogLabel } from "./utils";

export function LogList({ logs }: { logs: TaskLog[] }) {
  return (
    <div className="tlLogList">
      {logs.map((log) => (
        <div key={log.id} className={`logLine ${log.level} ${deriveLogKind(log)}`}>
          <time>{new Date(log.createdAt).toLocaleTimeString()}</time>
          <small>{deriveLogLabel(log)}</small>
          <span>{log.message}</span>
        </div>
      ))}
    </div>
  );
}
