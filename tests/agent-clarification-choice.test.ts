import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type CardExport = {
  editorData: string;
  widgetInfo: string;
  type: string;
  mode: string;
};

const card = JSON.parse(
  readFileSync('templates/agent-clarification-choice-dynamic.json', 'utf8'),
) as CardExport;
const editor = JSON.parse(card.editorData) as {
  schema: { componentsMap: Array<{ componentName: string }>; componentsTree: Array<{ children: any[] }> };
  variableList: Array<{ name: string; private: boolean; type: string; schema?: Array<{ name: string; type: string }> }>;
  mockData: {
    cardData: { singleCheckboxItems: Array<{ value: number; text: string; checked: boolean }> };
    cardPrivateData: { singleCheckboxItems: Array<{ value: number; text: string; checked: boolean }> };
  };
};

describe('dynamic agent clarification card export', () => {
  it('keeps the native import envelope and component order', () => {
    expect(card.type).toBe('im');
    expect(card.mode).toBe('card');
    expect(editor.schema.componentsMap.map((item) => item.componentName)).toEqual([
      'BaseText', 'CheckboxList', 'Input', 'SingleButton', 'Card',
    ]);
    expect(editor.schema.componentsTree[0]!.children.map((item) => item.componentName)).toEqual([
      'BaseText', 'BaseText', 'CheckboxList', 'BaseText', 'Input', 'SingleButton', 'SingleButton',
    ]);
  });

  it('binds every user-facing label and the option list to runtime data', () => {
    const children = editor.schema.componentsTree[0]!.children;
    expect(children[0]!.props.text.content).toBe('${title}');
    expect(children[1]!.props.text.content).toBe('${choiceLabel}');
    expect(children[2]!.props.listData).toEqual({ variable: 'singleCheckboxItems', variableType: 'global' });
    expect(children[3]!.props.text.content).toBe('${freeTextLabel}');
    expect(children[4]!.props.placeholder.content).toBe('${freeTextPlaceholder}');
    expect(children[5]!.props.text.content).toBe('${continueText}');
    expect(children[6]!.props.text.content).toBe('${cancelText}');
    expect(card.widgetInfo).toContain('@data{data.cardData.title}');
    expect(card.widgetInfo).toContain('@data{data.cardData.choiceLabel}');
    expect(card.widgetInfo).toContain('@data{data.cardData.freeTextLabel}');
    expect(card.widgetInfo).toContain('@data{data.cardData.freeTextPlaceholder}');
    expect(card.widgetInfo).toContain('@data{data.cardData.continueText}');
    expect(card.widgetInfo).toContain('@data{data.cardData.cancelText}');
    expect(card.widgetInfo).not.toContain('SelectBlock');
    expect(card.widgetInfo).not.toContain('submitBtnText');
  });

  it('places free text after the dynamic single-choice list and exposes two actions', () => {
    const children = editor.schema.componentsTree[0]!.children;
    expect(children.findIndex((item) => item.componentName === 'CheckboxList'))
      .toBeLessThan(children.findIndex((item) => item.componentName === 'Input'));
    expect(children[2]!.props.localVarAction).toMatchObject({
      variable: 'localSingleCheckbox',
      varType: 'number',
    });
    expect(children[5]!.id).toBe('node_oclw9159003');
    expect(children[6]!.id).toBe('node_cancel_button');
    expect(card.widgetInfo).toContain('single_button_node_oclw9159003');
    expect(card.widgetInfo).toContain('single_button_node_cancel');
  });

  it('uses the loop item contract in its import preview data', () => {
    const schema = editor.variableList.find((item) => item.name === 'singleCheckboxItems');
    expect(schema).toMatchObject({ private: true, type: 'loopArray' });
    expect(schema?.schema).toEqual([
      { id: 'singleCheckboxItems[0].value', type: 'number', name: 'value', private: true, editorVarType: 'variables' },
      { id: 'singleCheckboxItems[0].text', type: 'string', name: 'text', private: true, editorVarType: 'variables' },
      { id: 'singleCheckboxItems[0].checked', type: 'boolean', name: 'checked', private: true, editorVarType: 'variables' },
    ]);
    expect(editor.mockData.cardData.singleCheckboxItems).toEqual([
      { value: 0, text: '整体表现：先给我总体判断', checked: false },
      { value: 1, text: '优先问题：找最值得先处理的对象', checked: false },
      { value: 2, text: '原因核查：区分已确认问题和待验证原因', checked: false },
      { value: 3, text: '自主判断：你先找最值得关注的地方', checked: false },
    ]);
    expect(editor.mockData.cardPrivateData.singleCheckboxItems)
      .toEqual(editor.mockData.cardData.singleCheckboxItems);
  });
});
