import request from '@/utils/request';
import type { components } from '@/types/api.generated';

type Schemas = components['schemas'];
export type MoveInSelection = { contractId: string } | { contract: Schemas['CreateContractDto'] };
export type MoveInPreview = Schemas['MoveInPreviewDto'];
export type MoveInConfirmation = MoveInSelection & Omit<Schemas['ConfirmMoveInDto'], 'contractId' | 'contract'>;

export const previewMoveIn = (roomId: string, data: MoveInSelection): Promise<MoveInPreview> =>
  request.post(`/rooms/${roomId}/move-in/preview`, data);

export const confirmMoveIn = (roomId: string, data: MoveInConfirmation): Promise<Schemas['MoveInResultDto']> =>
  request.post(`/rooms/${roomId}/move-in`, data);
