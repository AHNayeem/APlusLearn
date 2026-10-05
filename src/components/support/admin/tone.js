import { SUPPORT_TICKET_STATUS } from "@/constants";

/** Badge tone for a ticket status — shared by the queue and the detail view. */
export function supportStatusTone(status) {
  if (status === SUPPORT_TICKET_STATUS.OPEN) return "danger";
  if (status === SUPPORT_TICKET_STATUS.IN_PROGRESS) return "warning";
  if (status === SUPPORT_TICKET_STATUS.RESOLVED) return "success";
  return "neutral";
}
