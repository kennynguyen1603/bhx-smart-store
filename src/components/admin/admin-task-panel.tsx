"use client";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TASK_STATUS_PRESENTATION } from "@/lib/task-status";
import type { TaskCreateValues } from "./admin-form-schemas";
import type { ReferenceOption } from "./forms/reference-fields";

export type AdminTask = {
  id: string; title: string; type: TaskCreateValues["type"]; priority: TaskCreateValues["priority"];
  status: keyof typeof TASK_STATUS_PRESENTATION;
  product: { name: string }; shelf: { label: string }; lot: { batchCode: string } | null;
  assignee: ReferenceOption | null; note: string | null;
  createdAt: string; updatedAt: string; completedAt: string | null; dueAt: string | null;
};
const types = { RESTOCK: "Bổ sung hàng", FEFO: "FEFO", QUARANTINE: "Cách ly" };
const priorities = { NORMAL: "Bình thường", MEDIUM: "Trung bình", HIGH: "Cao" };
function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: ReferenceOption[] }) {
  const id = useId();
  return <div className="admin-task-filter"><Label htmlFor={id}>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent></Select></div>;
}
function Timestamp({ value }: { value: string }) { return <time dateTime={value}>{new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))}</time>; }
export function AdminTaskPanel({ tasks, assignees, canCreate, onCreate }: { tasks: AdminTask[]; assignees: ReferenceOption[]; canCreate: boolean; onCreate: () => void }) {
  const [status, setStatus] = useState("all"), [type, setType] = useState("all"), [assignee, setAssignee] = useState("all");
  const people = [...new Map([...assignees, ...tasks.flatMap(task => task.assignee ? [task.assignee] : [])].map(person => [person.id, person])).values()];
  const filtered = tasks.filter(task => (status === "all" || task.status === status) && (type === "all" || task.type === type) && (assignee === "all" || (assignee === "unassigned" ? !task.assignee : task.assignee?.id === assignee)));
  return <section className="panel admin-task-panel">
    <header className="panel-header"><h2>Nhiệm vụ tại cửa hàng</h2><Button disabled={!canCreate} onClick={onCreate}>Giao nhiệm vụ</Button></header>
    <p className="muted">Theo dõi tối đa 100 nhiệm vụ, ưu tiên nhiệm vụ đang hoạt động và mới tạo. Nhân viên thực hiện công việc trong ứng dụng nhân viên.</p>
    {!canCreate && <p className="muted">Cần sản phẩm đã được gắn với kệ tại cửa hàng để giao nhiệm vụ.</p>}
    <div className="admin-task-filters">
      <Filter label="Trạng thái" value={status} onChange={setStatus} options={[{ id: "all", name: "Tất cả trạng thái" }, ...Object.entries(TASK_STATUS_PRESENTATION).map(([id, presentation]) => ({ id, name: presentation.label }))]} />
      <Filter label="Loại nhiệm vụ" value={type} onChange={setType} options={[{ id: "all", name: "Tất cả loại" }, ...Object.entries(types).map(([id, name]) => ({ id, name }))]} />
      <Filter label="Lọc người nhận" value={assignee} onChange={setAssignee} options={[{ id: "all", name: "Tất cả người nhận" }, { id: "unassigned", name: "Chưa phân công" }, ...people]} />
    </div>
    <div className="table-scroll"><table className="data-table admin-task-table"><thead><tr><th>Nhiệm vụ</th><th>Kệ / Lô</th><th>Người nhận</th><th>Trạng thái</th><th>Hoàn thành lúc</th></tr></thead><tbody>
      {filtered.map(task => <tr key={task.id}><td><strong>{task.product.name}</strong><br /><span>{types[task.type]}</span><details><summary>Xem chi tiết</summary><p>{task.title}</p>{task.note && <p>{task.note}</p>}<p>Tạo lúc: <Timestamp value={task.createdAt} /></p><p>Cập nhật: <Timestamp value={task.updatedAt} /></p>{task.dueAt && <p>Hạn hoàn thành: <Timestamp value={task.dueAt} /></p>}</details></td><td>{task.shelf.label}<br /><small>{task.lot?.batchCode || "Không gắn lô"}</small></td><td>{task.assignee?.name || "Chưa phân công"}</td><td><div className="admin-task-badges"><Badge variant={TASK_STATUS_PRESENTATION[task.status].variant}>{TASK_STATUS_PRESENTATION[task.status].label}</Badge><Badge variant={task.priority === "HIGH" ? "destructive" : "outline"}>{priorities[task.priority]}</Badge></div></td><td>{task.completedAt ? <Timestamp value={task.completedAt} /> : "—"}</td></tr>)}
    </tbody></table></div>
    {!filtered.length && <p className="muted">Không có nhiệm vụ phù hợp.</p>}
  </section>;
}
