import { Injectable, Logger } from '@nestjs/common';
import {
  ElectronicSignProvider,
  SignFlowInitParams,
  SignFlowInitResult,
  SignFlowStatusResult,
} from './electronic-sign-provider.interface.js';

@Injectable()
export class MockElectronicSignProvider implements ElectronicSignProvider {
  private readonly logger = new Logger(MockElectronicSignProvider.name);
  private flows = new Map<string, SignFlowStatusResult>();

  async createSignFlow(params: SignFlowInitParams): Promise<SignFlowInitResult> {
    const flowId = `ESIGN_${params.contractNumber}_${Date.now()}`;
    const signUrl = `https://esign-mock.local/sign?flowId=${flowId}&contractId=${params.contractId}`;
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

    const signers = [
      { name: params.tenant.name, phone: params.tenant.phone, status: 'PENDING' as const },
      ...(params.coTenants
        ?.filter((c) => c.isSigner)
        .map((c) => ({
          name: c.name,
          phone: c.phone,
          status: 'PENDING' as const,
        })) || []),
    ];

    this.flows.set(flowId, {
      flowId,
      status: 'SIGNING',
      signers,
    });

    this.logger.log(`[MockElectronicSign] 发起签约流程: flowId=${flowId}, 签约方数=${signers.length}`);
    return { flowId, signUrl, expiresAt };
  }

  async querySignStatus(flowId: string): Promise<SignFlowStatusResult> {
    const flow = this.flows.get(flowId);
    if (!flow) {
      return {
        flowId,
        status: 'SIGNING',
        signers: [],
      };
    }
    return flow;
  }

  async handleCallback(payload: any): Promise<{
    flowId: string;
    status: 'SIGNED' | 'REJECTED';
    signedAt?: Date;
    docUrl?: string;
  }> {
    const flowId = payload?.flowId;
    const status = payload?.status === 'REJECTED' ? 'REJECTED' : 'SIGNED';
    const signedAt = new Date();
    const docUrl = `/api/public/files/signed-${flowId}.pdf`;

    const existing = this.flows.get(flowId);
    if (existing) {
      existing.status = status;
      existing.signedAt = signedAt.toISOString();
      existing.docUrl = docUrl;
      existing.signers.forEach((s) => (s.status = status));
    }

    return { flowId, status, signedAt, docUrl };
  }

  /** 测试/开发辅助：模拟租客在线签名完成 */
  simulateSigned(flowId: string): SignFlowStatusResult {
    const flow = this.flows.get(flowId) || {
      flowId,
      status: 'SIGNING',
      signers: [],
    };
    flow.status = 'SIGNED';
    flow.signedAt = new Date().toISOString();
    flow.docUrl = `/api/public/files/signed-${flowId}.pdf`;
    flow.signers.forEach((s) => {
      s.status = 'SIGNED';
      s.signedAt = flow.signedAt;
    });
    this.flows.set(flowId, flow);
    return flow;
  }
}
