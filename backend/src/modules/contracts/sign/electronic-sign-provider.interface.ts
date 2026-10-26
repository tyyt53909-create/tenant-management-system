export const ELECTRONIC_SIGN_PROVIDER = Symbol('ELECTRONIC_SIGN_PROVIDER');

export interface SignFlowInitParams {
  contractId: string;
  contractNumber: string;
  title: string;
  tenant: {
    name: string;
    phone: string;
    idNumberMasked?: string;
  };
  coTenants?: Array<{
    name: string;
    phone: string;
    isSigner: boolean;
  }>;
  pdfBuffer?: Buffer;
}

export interface SignFlowInitResult {
  flowId: string;
  signUrl: string;
  expiresAt: string;
}

export interface SignFlowStatusResult {
  flowId: string;
  status: 'SIGNING' | 'SIGNED' | 'REJECTED' | 'EXPIRED';
  signedAt?: string;
  docUrl?: string;
  signers: Array<{
    name: string;
    phone: string;
    status: 'PENDING' | 'SIGNED' | 'REJECTED';
    signedAt?: string;
  }>;
}

export interface ElectronicSignProvider {
  createSignFlow(params: SignFlowInitParams): Promise<SignFlowInitResult>;
  querySignStatus(flowId: string): Promise<SignFlowStatusResult>;
  handleCallback(payload: any): Promise<{
    flowId: string;
    status: 'SIGNED' | 'REJECTED';
    signedAt?: Date;
    docUrl?: string;
  }>;
}
