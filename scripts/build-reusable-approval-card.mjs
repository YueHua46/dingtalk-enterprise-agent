import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const [sourcePath, outputPath = 'templates/agent-approval-reusable.json'] = process.argv.slice(2);
if (!sourcePath) {
  throw new Error('Usage: node scripts/build-reusable-approval-card.mjs <exported-template.json> [output.json]');
}

const exported = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const editor = JSON.parse(exported.editorData);
const card = editor.schema.componentsTree.find((node) => node.componentName === 'Card');
assert(card, 'Card component is missing');

function findNode(name) {
  const queue = [card];
  while (queue.length) {
    const node = queue.shift();
    if (node.componentName === name) return node;
    queue.push(...(node.children ?? []));
  }
  throw new Error(`${name} component is missing`);
}

const buttons = findNode('ButtonList');
const actions = buttons.props.buttons.list;
assert.deepEqual(actions.map((button) => button.actionId.content).sort(), ['agree', 'reject']);

for (const button of actions) {
  assert.equal(button.actionType, 'request');
  assert.equal(button.params.find((param) => param.name === 'action')?.value, button.actionId.content);
  button.params.push({
    type: 'variable',
    variable: 'challengeId',
    value: '',
    name: 'challengeId',
    variableType: 'global',
    id: '2',
  });
}

buttons.props.visible = {
  type: 'dynamicVisible',
  value: true,
  valueType: 'condition',
  condition: {
    op: 'and',
    conditions: [{
      value: 'pending',
      op: 'equal',
      variable: 'status',
      variableType: 'global',
      type: 'variable',
      valueType: 'fixed',
      valueVariableType: 'global',
    }],
  },
};

const terminalButtons = card.children.filter((node) => node.componentName === 'SingleButton');
assert.equal(terminalButtons.length, 2);
const [doneButton, cancelledButton] = terminalButtons;
doneButton.props.text.content = '任务已结束';
doneButton.props.visible.condition.conditions[0].value = 'done';
cancelledButton.props.text.content = '任务已取消';
cancelledButton.props.visible.condition.conditions[0].value = 'cancelled';

const header = findNode('BaseText');
header.props.text.content = 'Agent 操作确认';
const tag = findNode('Tag');
tag.props.text.content = '进度面板';
const timeText = card.children.find((node) => node.id === 'node_ocl9s7wvur9');
assert(timeText, 'Timestamp component is missing');
timeText.props.text.content = '任务开始：${createTime}';

assert(!editor.variableList.some((variable) => variable.name === 'challengeId'));
editor.variableList.push({
  name: 'challengeId',
  private: false,
  type: 'string',
  id: 'challengeId',
  description: '本次操作唯一编号（由 Agent 生成，按钮回传）',
  editorVarType: 'variables',
});
editor.mockData.cardData = {
  ...editor.mockData.cardData,
  createTime: '2026-09-24 10:00:00',
  status: 'pending',
  challengeId: 'preview-operation-001',
  content: '### 待您确认：修改在线文档\n\n**将要做什么**：在《测试文档》中写入“Hello World”。\n\n请在 5 分钟内选择。未确认则自动取消。\n\n---\n**任务进度**：已完成 2 项 · 已拒绝 0 项\n\n最近记录：\n- 10:01 已同意：创建在线文档\n- 10:02 已完成：写入标题',
};

function replaceExactlyOnce(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, `Expected exactly one widgetInfo match: ${before.slice(0, 80)}`);
  return source.replace(before, after);
}

let widgetInfo = exported.widgetInfo;
const pendingVisibility = "@triple{@equal{@toStr{@data{data.cardData.status}}, @toStr{&#039;pending&#039;}}, &#039;visible&#039;, &#039;gone&#039;}";
widgetInfo = replaceExactlyOnce(
  widgetInfo,
  "@triple{@and{@not{@equal{@toStr{@data{data.cardData.status}}, @toStr{&#039;agree&#039;}}},@not{@equal{@toStr{@data{data.cardData.status}}, @toStr{&#039;reject&#039;}}}}, &#039;visible&#039;, &#039;gone&#039;}",
  pendingVisibility,
);
for (const action of ['agree', 'reject']) {
  widgetInfo = replaceExactlyOnce(
    widgetInfo,
    `@dtMapAppend{null, &#039;action&#039;, &#039;${action}&#039;}`,
    `@dtMapAppend{null, &#039;action&#039;, &#039;${action}&#039;, &#039;challengeId&#039;, @toStr{@data{data.cardData.challengeId}}}`, 
  );
}
widgetInfo = replaceExactlyOnce(
  widgetInfo,
  "visibility=\"@triple{@equal{@toStr{@data{data.cardData.status}}, @toStr{&#039;agree&#039;}}, &#039;visible&#039;, &#039;gone&#039;}\"",
  "visibility=\"@triple{@equal{@toStr{@data{data.cardData.status}}, @toStr{&#039;done&#039;}}, &#039;visible&#039;, &#039;gone&#039;}\"",
);
widgetInfo = replaceExactlyOnce(
  widgetInfo,
  "visibility=\"@triple{@equal{@toStr{@data{data.cardData.status}}, @toStr{&#039;reject&#039;}}, &#039;visible&#039;, &#039;gone&#039;}\"",
  "visibility=\"@triple{@equal{@toStr{@data{data.cardData.status}}, @toStr{&#039;cancelled&#039;}}, &#039;visible&#039;, &#039;gone&#039;}\"",
);
for (const [before, after] of [
  ['操作需要确认', 'Agent 操作确认'],
  ['操作确认', '进度面板'],
  ['创建时间：', '任务开始：'],
  ['已同意', '任务已结束'],
  ['已拒绝', '任务已取消'],
]) {
  // The header also contains “操作确认”; only the quoted XML text for the tag changes.
  const oldText = `@toStr{&#039;${before}&#039;}`;
  const newText = `@toStr{&#039;${after}&#039;}`;
  if (widgetInfo.includes(oldText)) widgetInfo = replaceExactlyOnce(widgetInfo, oldText, newText);
  else widgetInfo = replaceExactlyOnce(widgetInfo, `&#039;${before}&#039;`, `&#039;${after}&#039;`);
}

exported.editorData = JSON.stringify(editor);
exported.widgetInfo = widgetInfo;
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(exported)}\n`, 'utf8');
console.log(`Wrote ${outputPath}`);
