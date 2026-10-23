import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

class ProbeController {
  protectedHandler() {}

  publicHandler() {}
}

function contextFor(handler: () => void): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ProbeController,
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard 默认拒绝（T257 / SEC-01）', () => {
  const guard = new JwtAuthGuard(new Reflector());
  const superPrototype = Object.getPrototypeOf(JwtAuthGuard.prototype) as {
    canActivate: (context: ExecutionContext) => unknown;
  };
  const superSpy = vi.spyOn(superPrototype, 'canActivate');

  afterEach(() => {
    superSpy.mockReset();
    Reflect.deleteMetadata(IS_PUBLIC_KEY, ProbeController);
    Reflect.deleteMetadata(IS_PUBLIC_KEY, ProbeController.prototype.protectedHandler);
    Reflect.deleteMetadata(IS_PUBLIC_KEY, ProbeController.prototype.publicHandler);
  });

  it('未标注 @Public 的处理器交给 passport 校验（默认拒绝）', () => {
    superSpy.mockReturnValue('passport-called');

    const result = guard.canActivate(contextFor(ProbeController.prototype.protectedHandler));

    expect(result).toBe('passport-called');
    expect(superSpy).toHaveBeenCalledTimes(1);
  });

  it('方法标注 @Public 时直接放行，不触发 passport', () => {
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, ProbeController.prototype.publicHandler);

    const result = guard.canActivate(contextFor(ProbeController.prototype.publicHandler));

    expect(result).toBe(true);
    expect(superSpy).not.toHaveBeenCalled();
  });

  it('类标注 @Public 时所有处理器放行', () => {
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, ProbeController);

    const result = guard.canActivate(contextFor(ProbeController.prototype.protectedHandler));

    expect(result).toBe(true);
    expect(superSpy).not.toHaveBeenCalled();
  });
});
