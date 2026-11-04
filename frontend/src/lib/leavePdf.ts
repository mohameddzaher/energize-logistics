// The official leave sheet is built on the server (backend services/leaveSheet), so web and mobile download the same file and signatures are read at print time.
import api from './api';

export async function downloadLeaveSheet(leaveId: string, fileHint = '') {
  const blob = await api.getBlob(`/api/hr/leaves/${leaveId}/sheet.pdf`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `leave-${(fileHint || leaveId).replace(/\s+/g, '_')}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
