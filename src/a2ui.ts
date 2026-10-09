import { createHash, randomUUID } from 'node:crypto';

export type A2UIFlowStatus = 'PROCESSING' | 'INPUTTING' | 'EXECUTING' | 'FINISH' | 'ERROR' | 'ABORTED' | 'TIMEOUT' | 'CONFIRMING' | 'CONFIRMED';
export type A2UIMessage = Record<string, unknown>;

export interface UiAction {
  id: string;
  type: 'submit' | 'confirm' | 'open' | 'retry' | 'custom';
  label: string;
  payload?: Record<string, unknown>;
  requiresOriginator?: boolean;
}

export interface UiNode {
  id: string;
  component: string;
  props?: Record<string, unknown>;
  children?: UiNode[];
  dataPath?: string;
  visibleWhen?: Record<string, unknown>;
}

export interface AgentUiDocument {
  title?: string;
  description?: string;
  root: UiNode;
  data?: Record<string, unknown>;
  actions?: UiAction[];
}

export interface ExecutionStep {
  id: string;
  label: string;
  kind: 'plan' | 'tool' | 'analysis' | 'artifact' | 'confirmation';
  status: 'running' | 'success' | 'failed' | 'cancelled';
  summary?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ExecutionUiState {
  title: string;
  status: 'processing' | 'inputting' | 'executing' | 'confirming' | 'confirmed' | 'finished' | 'error' | 'aborted' | 'timeout';
  steps: ExecutionStep[];
  activeStepId?: string;
  result?: AgentUiDocument;
}

const allowedComponents = new Set([
  'Card', 'CardHeader', 'Column', 'Row', 'Text', 'Markdown', 'Divider', 'Icon', 'Tag',
  'Button', 'ButtonGroup', 'CollapsiblePanel', 'ColumnLayout', 'GridLayout', 'Link', 'List',
  'Loop', 'ScrollView', 'Stack', 'Tabs', 'CheckBox', 'CheckboxListMulti', 'ChoicePicker',
  'ConversationPicker', 'DateTimeInput', 'ImageUpload', 'InputList', 'NumberInput', 'Rating',
  'Slider', 'Switch', 'TextField', 'UserPicker', 'AudioPlayer', 'Avatar', 'AvatarGroup',
  'Chart', 'Countdown', 'ElapsedTime', 'File', 'Image', 'ImageCarousel', 'ImageList', 'ProgressBar',
  'Table', 'Video'
]);

export function validateUiDocument(document: AgentUiDocument, limits = { maxNodes: 200, maxBytes: 256 * 1024 }): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  let nodes = 0;
  const visit = (node: UiNode, path: string): void => {
    nodes += 1;
    if (nodes > limits.maxNodes) errors.push(`ui.node_limit_exceeded:${limits.maxNodes}`);
    if (!node || typeof node !== 'object') { errors.push(`${path}:node_required`); return; }
    if (!node.id || typeof node.id !== 'string') errors.push(`${path}.id:required`);
    else if (ids.has(node.id)) errors.push(`${path}.id:duplicate:${node.id}`);
    else ids.add(node.id);
    if (!allowedComponents.has(node.component)) errors.push(`${path}.component:unsupported:${node.component}`);
    if (node.component === 'Card' && (node.children?.length ?? 0) !== 1) errors.push(`${path}.children:card_requires_one_child`);
    if (node.children && !Array.isArray(node.children)) errors.push(`${path}.children:array_required`);
    for (const [index, child] of (node.children ?? []).entries()) visit(child, `${path}.children[${index}]`);
  };
  visit(document.root, 'root');
  for (const action of document.actions ?? []) {
    if (!action.id || !action.label) errors.push('actions:each action needs id and label');
    if (!['submit', 'confirm', 'open', 'retry', 'custom'].includes(action.type)) errors.push(`actions.${action.id ?? '?'}:type_invalid`);
    if (typeof action.requiresOriginator !== 'undefined' && typeof action.requiresOriginator !== 'boolean') errors.push(`actions.${action.id ?? '?'}:requiresOriginator_boolean`);
  }
  if (JSON.stringify(document).length > limits.maxBytes) errors.push(`ui.byte_limit_exceeded:${limits.maxBytes}`);
  return [...new Set(errors)];
}

export function executionToA2UI(state: ExecutionUiState, catalogId: string, surfaceId: string): A2UIMessage[] {
  const data = {
    title: state.title,
    status: state.status,
    activeStepId: state.activeStepId ?? '',
    steps: state.steps.map((step) => ({ ...step })),
    result: state.result?.data ?? {}
  };
  const stepIds = state.steps.map((step) => `step-${step.id}`);
  const stepNodes: UiNode[] = state.steps.map((step) => ({
    id: `step-${step.id}`,
    component: 'Row',
    props: { spacing: 'small' },
    children: [
      { id: `step-status-${step.id}`, component: 'Icon', props: { name: step.status === 'success' ? 'success' : step.status === 'failed' ? 'error' : 'loading' } },
      { id: `step-label-${step.id}`, component: 'Text', props: { text: step.summary ? `${step.label}：${step.summary}` : step.label } }
    ]
  }));
  const resultNode = state.result ? documentToNode(state.result) : { id: 'result-empty', component: 'Text', props: { text: '正在准备结果…' } };
  const root: UiNode = {
    id: 'root', component: 'Card', children: [{
      id: 'root-column', component: 'Column', children: [
        { id: 'header', component: 'CardHeader', props: { title: state.title } },
        { id: 'execution', component: 'CollapsiblePanel', props: { title: '执行过程', variant: 'reasoning', defaultExpanded: true }, children: [{ id: 'execution-steps', component: 'Column', children: stepNodes }] },
        { id: 'status', component: 'Text', props: { text: statusLabel(state.status), textEffect: state.status === 'processing' || state.status === 'executing' ? 'shimmer' : undefined } },
        resultNode
      ]
    }]
  };
  return [
    { version: 'v1.0', createSurface: { surfaceId, catalogId } },
    { version: 'v1.0', updateDataModel: { surfaceId, path: '/', value: data } },
    { version: 'v1.0', updateComponents: { surfaceId, components: flattenComponents(root) } }
  ];
}

export function documentToMessages(document: AgentUiDocument, catalogId: string, surfaceId: string): A2UIMessage[] {
  const errors = validateUiDocument(document);
  if (errors.length) throw new Error(`A2UI_INVALID:${errors.join('|')}`);
  return [
    { version: 'v1.0', createSurface: { surfaceId, catalogId } },
    { version: 'v1.0', updateDataModel: { surfaceId, path: '/', value: document.data ?? {} } },
    { version: 'v1.0', updateComponents: { surfaceId, components: flattenComponents(document.root) } }
  ];
}

export function stableSurfaceId(taskId: string): string { return `agent-${createHash('sha256').update(taskId).digest('hex').slice(0, 24)}`; }
export function newOutTrackId(taskId: string): string { return `${taskId}-${randomUUID()}`; }

function documentToNode(document: AgentUiDocument): UiNode {
  return { id: 'result', component: 'Column', children: [document.root] };
}

function flattenComponents(root: UiNode): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = [];
  const visit = (node: UiNode): void => {
    const component: Record<string, unknown> = { id: node.id, component: node.component, ...(node.props ?? {}) };
    const children = node.children ?? [];
    const childContainers = new Set(['Column', 'Row', 'CollapsiblePanel', 'ColumnLayout', 'GridLayout', 'Stack', 'ScrollView', 'Tabs', 'ButtonGroup']);
    if (children.length || childContainers.has(node.component)) {
      if (node.component === 'Card') component.child = children[0]!.id;
      else component.children = children.map((child) => child.id);
    }
    components.push(component);
    for (const child of children) visit(child);
  };
  visit(root);
  return components;
}

function statusLabel(status: ExecutionUiState['status']): string {
  return ({ processing: '正在准备', inputting: '正在生成', executing: '正在执行', confirming: '等待确认', confirmed: '已确认', finished: '已完成', error: '执行失败', aborted: '已中止', timeout: '已超时' })[status];
}
