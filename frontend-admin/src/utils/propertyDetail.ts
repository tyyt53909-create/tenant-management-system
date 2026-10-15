import { formatDateOnly, formatMoney } from './table';
import { protectedFilePath } from './resource';
import type { ResourceRecord } from './resource';

export type PropertyKind = 'rooms' | 'contracts';
export const ROOM_TYPES: Record<string, string> = { SINGLE:'单间', ONE_BED:'一室一厅', TWO_BED:'两室一厅', THREE_BED:'三室一厅', STUDIO:'开间' };
export const PAYMENT_CYCLES: Record<string, string> = { MONTHLY:'月付', QUARTERLY:'季付', SEMI_ANNUAL:'半年付', ANNUAL:'年付' };
export const detailTabs = (kind: PropertyKind) => kind === 'rooms'
  ? [{ id:'overview',label:'概览' },{ id:'leases',label:'租约信息' },{ id:'bills',label:'账单记录' },{ id:'audit',label:'操作记录' }]
  : [{ id:'overview',label:'合同信息' },{ id:'tenant',label:'租客信息' },{ id:'room',label:'房源信息' },{ id:'bills',label:'账单记录' },{ id:'files',label:'合同图片' }];

export function stateTone(state: string) {
  if (['ACTIVE','OCCUPIED','CLEAN','PAID','COMPLETED'].includes(state)) return 'success';
  if (['RESERVED','RENEWED','ASSIGNED'].includes(state)) return 'info';
  if (['EXPIRED','OVERDUE','TERMINATED'].includes(state)) return 'danger';
  if (['MAINTENANCE','PENDING_CLEAN','CLEANING','PARTIAL','PENDING'].includes(state)) return 'warning';
  return 'neutral';
}

export const displayMoney = (value: unknown) => value == null ? '—' : formatMoney(Number(value));
export function roomFacts(room: ResourceRecord, lease?: ResourceRecord | null) {
  return [
    { icon:'building',label:'所属楼栋',value:room.building?.name || '—' },
    { icon:'floor',label:'楼层',value:room.floor == null ? '—' : `${room.floor} 楼` },
    { icon:'house',label:'房型',value:ROOM_TYPES[room.roomType] || '—' },
    { icon:'area',label:'建筑面积',value:room.area == null ? '—' : `${room.area} m²` },
    { icon:'money',label:'租约月租',value:lease ? displayMoney(lease.rentAmount) : '暂无当前租约' },
    { icon:'number',label:'房源编号',value:room.roomNumber || '—' },
  ];
}

export function propertyPhotos(kind: PropertyKind, record: ResourceRecord | null) {
  const photos = kind === 'rooms' ? record?.photos : record?.room?.photos;
  if (!Array.isArray(photos)) return [];
  return photos.filter(photo => photo && typeof photo.fileUrl === 'string' && protectedFilePath(photo.fileUrl));
}

/** 房租只来自真实租约；已预订显示草稿，其他房态查生效合同，不冒充房源定价。 */
export function currentLeaseQuery(room: ResourceRecord) {
  return { roomId:room.id, status:room.status === 'RESERVED' ? 'DRAFT' : 'ACTIVE', limit:1 };
}

/** 只表示合同日期与状态，不推断租客已缴费，也不虚构下一张账单。 */
export function contractReminder(contract: ResourceRecord, now = new Date()) {
  if (contract.status === 'TERMINATED') return { tone:'neutral',title:'合同已终止',text:'保留原合同与附件，方便后续核查。' };
  if (contract.status === 'RENEWED') return { tone:'info',title:'原合同已续签',text:'请以续签后的合同约定为准。' };
  if (contract.status === 'DRAFT') return { tone:'neutral',title:'合同尚未生效',text:'当前为草稿，请核对签约资料与合同图片。' };
  const date = String(contract.endDate || '').slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { tone:'neutral',title:'到期日未记录',text:'请核对合同期限。' };
  const today = Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());
  const end = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(end)) return { tone:'neutral',title:'到期日未记录',text:'请核对合同期限。' };
  const days = Math.round((end-today)/86400000);
  if (days < 0 || contract.status === 'EXPIRED') return { tone:'danger',title:'合同已到期',text:`到期日 ${formatDateOnly(contract.endDate)}，请核对续签或退租安排。` };
  if (days <= 30) return { tone:'warning',title:days === 0 ? '合同今日到期' : '合同即将到期',text:`${days === 0 ? '今日' : `还有 ${days} 天`}到期，请提前确认续住安排。` };
  return { tone:'success',title:'合同生效中',text:`距合同到期还有 ${days} 天。缴费情况请查看账单记录。` };
}
