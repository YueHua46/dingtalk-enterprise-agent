import { describe, expect, it } from 'vitest';
import { legacyObservationCheckpoint, toolCheckpointKey } from '../src/tool-checkpoint.js';
import type { WorkflowState } from '../src/task-workflow.js';

describe('task-local tool checkpoint identity', () => {
  it('reuses nested object requests independently of key insertion order', () => {
    const key = (args: unknown) => toolCheckpointKey({namespace:'crossborderops',tool:'query',args});
    expect(key({dataset:'ads.metrics',params:{site:'DE',offset:0}}))
      .toBe(key({params:{offset:0,site:'DE'},dataset:'ads.metrics'}));
    expect(key({params:{offset:0,site:'DE'}})).not.toBe(key({params:{offset:1,site:'DE'}}));
    expect(key({dimensions:['site','campaign']})).not.toBe(key({dimensions:['campaign','site']}));
  });

  it('keeps calculation checkpoints dependent on their input evidence hashes', () => {
    const request = {namespace:'analysis',tool:'table',args:{evidenceId:'source'}};
    expect(toolCheckpointKey({...request,inputs:['old']})).not.toBe(toolCheckpointKey({...request,inputs:['new']}));
  });

  it('accepts argument-free read calls while looking for legacy observations', () => {
    expect(legacyObservationCheckpoint({evidence:[],revision:0},'crossborderops.scope',undefined)).toBeUndefined();
  });

  it('finds an old observation by exact saved query and evidence without reusing a calculation', () => {
    const checkpoint = {capabilityId:'crossborderops.ads.metrics',evidenceId:'e1',result:'saved',completedAt:'2026-10-14'};
    const state: WorkflowState = {evidence:[],revision:1,toolCheckpoints:{oldKey:checkpoint},
      evidenceFiles:[{file:'01.json',evidenceId:'e1',capabilityId:checkpoint.capabilityId,kind:'observation',
        arguments:'{"dataset":"ads.metrics","params":{"site":"DE","offset":0}}'}]};
    expect(legacyObservationCheckpoint(state,checkpoint.capabilityId,{params:{offset:0,site:'DE'},dataset:'ads.metrics'})).toBe(checkpoint);
    expect(legacyObservationCheckpoint(state,checkpoint.capabilityId,{params:{offset:1,site:'DE'},dataset:'ads.metrics'})).toBeUndefined();
    state.evidenceFiles![0]!.kind='calculation';
    expect(legacyObservationCheckpoint(state,checkpoint.capabilityId,{params:{offset:0,site:'DE'},dataset:'ads.metrics'})).toBeUndefined();
  });
});
