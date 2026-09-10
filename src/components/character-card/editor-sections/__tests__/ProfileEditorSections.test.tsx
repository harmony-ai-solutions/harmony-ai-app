/**
 * Editor-suite section tests (Phase 8, Track C) — retargeted from the deleted
 * comparison-only editor screen to the extracted section components.
 *
 * Verifies (props-in / onChange-out, testIDs preserved from the original
 * editor):
 *  - GreetingEditorSection: greeting editor wiring, [Preview opening] /
 *    [Test scenario generation] buttons, ephemeral test-result card.
 *  - AlternateGreetingsSection: forwards the manager props (add/edit/remove/
 *    move/promote).
 *  - LorebookSection: summary card opens the viewer with characterBook/onChange.
 *  - TagsSection / LifecycleSection / AttributionSection: onChange wiring +
 *    preserved testIDs.
 *  - ExportSection: JSON/PNG export sheet fires onExport.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

const THEME = {
  colors: {
    accent: { primary: '#7c3aed', secondary: '#a78bfa' },
    background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
    border: { default: '#333333' },
    text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa' },
    status: { error: '#ef4444', success: '#22c55e', warning: '#f59e0b' },
  },
} as any;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ theme: THEME }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
});

jest.mock('react-native-paper', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    Provider: ({ children }: any) => children,
    Portal: ({ children }: any) => React.createElement(View, null, children),
    Modal: ({ children, ...props }: any) =>
      props.visible ? React.createElement(View, { ...props }, children) : null,
  };
});

jest.mock('../../../themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ThemedView: ({ children, style, ...props }: any) =>
      React.createElement(View, { style, ...props }, children),
  };
});

jest.mock('../../../themed/ThemedCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ThemedCard: ({ children, style, ...props }: any) =>
      React.createElement(View, { style, ...props }, children),
  };
});

jest.mock('../../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ThemedText: ({ children, style, ...props }: any) =>
      React.createElement(Text, { style, ...props }, children),
  };
});

jest.mock('../../../themed/ThemedButton', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, disabled, testID, ...props }: any) =>
      React.createElement(
        View,
        {
          onPress: () => onPress(),
          accessibilityState: { disabled: !!disabled },
          testID,
          accessibilityRole: 'button',
          ...props,
        },
        React.createElement(Text, { testID: `${testID}-label` }, label),
      ),
  };
});

jest.mock('../../../themed/SectionHeader', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    SectionHeader: ({ title, ...props }: any) => React.createElement(Text, { ...props }, title),
  };
});

// GreetingBubble mock resolves macros so preview/test assertions can verify
// the charName/userName wiring end-to-end.
jest.mock('../../../chat/GreetingBubble', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const { resolveMacros } = require('../../../../utils/macros');
  return {
    __esModule: true,
    GreetingBubble: ({ text, charName, userName, ...props }: any) =>
      React.createElement(
        Text,
        { testID: 'greeting-bubble-text', ...props },
        resolveMacros(text ?? '', charName, userName),
      ),
  };
});

// Character-card building blocks: keep them as prop-passing hosts so the tests
// can read exactly what the sections wire (value, onChange, charName, …).
jest.mock('../../GreetingEditor', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    GreetingEditor: (props: any) => React.createElement(View, { testID: 'greeting-editor', ...props }),
  };
});

jest.mock('../../AlternateGreetingsManager', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AlternateGreetingsManager: (props: any) =>
      React.createElement(View, { testID: 'alternate-greetings-manager', ...props }),
  };
});

jest.mock('../../LorebookViewerSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    LorebookViewerSheet: (props: any) =>
      React.createElement(View, { testID: 'lorebook-viewer-sheet', ...props }),
  };
});

jest.mock('../../LifecycleConfigEditor', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    LifecycleConfigEditor: (props: any) =>
      React.createElement(View, { testID: 'lifecycle-config-editor', ...props }),
  };
});

jest.mock('../../TagChips', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    TagChips: (props: any) => React.createElement(View, { testID: 'tag-chips', ...props }),
  };
});

jest.mock('../../CreatorAttributionBadge', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    CreatorAttributionBadge: (props: any) =>
      React.createElement(View, { testID: 'creator-badge', ...props }),
  };
});

jest.mock('../../MacroHighlighter', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    MacroHighlighter: (props: any) =>
      React.createElement(View, { testID: 'macro-highlighter', ...props }),
  };
});

jest.mock('../../SheetModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    SheetModal: ({ children, ...props }: any) =>
      React.createElement(View, { testID: 'sheet-modal', ...props }, children),
  };
});

import { GreetingEditorSection } from '../GreetingEditorSection';
import { AlternateGreetingsSection } from '../AlternateGreetingsSection';
import { LorebookSection } from '../LorebookSection';
import { TagsSection } from '../TagsSection';
import { LifecycleSection } from '../LifecycleSection';
import { AttributionSection } from '../AttributionSection';
import { ExportSection } from '../ExportSection';

describe('Editor sections (Phase 8) — props-in / onChange-out wiring', () => {
  it('GreetingEditorSection wires the greeting editor + preview/test scenario buttons', async () => {
    const onTestScenario = jest.fn();
    const onUse = jest.fn();
    const onDiscard = jest.fn();
    const { getByTestId, getByText, queryByTestId } = await render(
      <GreetingEditorSection
        firstMes="Hi {{user}}!"
        onChangeFirstMes={jest.fn()}
        charName="Nix"
        userName="Alex"
        testState="idle"
        testGreeting=""
        onTestScenario={onTestScenario}
        onUseTestGreeting={onUse}
        onDiscardTestGreeting={onDiscard}
      />,
    );

    expect(getByTestId('greeting-editor').props.value).toBe('Hi {{user}}!');
    expect(getByTestId('greeting-editor').props.charName).toBe('Nix');
    expect(getByTestId('greeting-editor').props.userName).toBe('Alex');
    expect(queryByTestId('test-scenario-use')).toBeNull();

    // [Preview opening] resolves macros via the GreetingBubble preview.
    await fireEvent.press(getByTestId('preview-opening-button'));
    expect(getByText('Hi Alex!')).toBeTruthy();
    expect(getByTestId('opening-preview')).toBeTruthy();

    // [Test scenario generation] fires the screen-owned callback.
    await fireEvent.press(getByTestId('test-scenario-button'));
    expect(onTestScenario).toHaveBeenCalledTimes(1);
  });

  it('GreetingEditorSection shows the ephemeral result card only in ready state', async () => {
    const { getByTestId, getByText } = await render(
      <GreetingEditorSection
        firstMes=""
        onChangeFirstMes={jest.fn()}
        charName="Nix"
        userName="Alex"
        testState="ready"
        testGreeting="Generated {{user}}!"
        onTestScenario={jest.fn()}
        onUseTestGreeting={jest.fn()}
        onDiscardTestGreeting={jest.fn()}
      />,
    );

    expect(getByTestId('test-scenario-use')).toBeTruthy();
    expect(getByTestId('test-scenario-discard')).toBeTruthy();
    expect(getByText('Generated Alex!')).toBeTruthy();
  });

  it('GreetingEditorSection testDisabled hides [Test scenario generation] (personaMode)', async () => {
    const { getByTestId, queryByTestId } = await render(
      <GreetingEditorSection
        firstMes="Hi {{user}}!"
        onChangeFirstMes={jest.fn()}
        charName="Nix"
        userName="Alex"
        testState="idle"
        testGreeting=""
        onTestScenario={jest.fn()}
        onUseTestGreeting={jest.fn()}
        onDiscardTestGreeting={jest.fn()}
        testDisabled
      />,
    );

    // Decision 13: personas never generate greetings as partners — the TEST
    // affordance is gone while [Preview opening] stays.
    expect(queryByTestId('test-scenario-button')).toBeNull();
    expect(getByTestId('preview-opening-button')).toBeTruthy();
    expect(getByTestId('greeting-editor').props.value).toBe('Hi {{user}}!');
  });

  it('AlternateGreetingsSection forwards the manager props (add/edit/move/promote)', async () => {
    const onAdd = jest.fn();
    const onEdit = jest.fn();
    const { getByTestId } = await render(
      <AlternateGreetingsSection
        alternateGreetings={['Alt A', 'Alt B']}
        firstMes="Default"
        charName="Nix"
        userName="Alex"
        onAdd={onAdd}
        onRemove={jest.fn()}
        onMove={jest.fn()}
        onEdit={onEdit}
        onPromoteToDefault={jest.fn()}
      />,
    );

    const manager = getByTestId('alternate-greetings-manager');
    expect(manager.props.alternateGreetings).toEqual(['Alt A', 'Alt B']);
    expect(manager.props.firstMes).toBe('Default');
    expect(manager.props.charName).toBe('Nix');
    expect(manager.props.userName).toBe('Alex');

    await act(async () => { manager.props.onAdd(); });
    expect(onAdd).toHaveBeenCalledTimes(1);
    await act(async () => { manager.props.onEdit(0, 'Edited'); });
    expect(onEdit).toHaveBeenCalledWith(0, 'Edited');
  });

  it('LorebookSection opens the viewer with characterBook/onChange', async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <LorebookSection characterBook='{"entries":[]}' onChange={onChange} />,
    );

    await fireEvent.press(getByTestId('lorebook-summary-card'));
    const viewer = getByTestId('lorebook-viewer-sheet');
    expect(viewer.props.open).toBe(true);
    expect(viewer.props.characterBook).toBe('{"entries":[]}');

    await act(async () => {
      viewer.props.onChange('{"entries":[{"keys":["k"],"content":"c"}]}');
    });
    expect(onChange).toHaveBeenCalledWith('{"entries":[{"keys":["k"],"content":"c"}]}');
  });

  it('TagsSection preserves the profile-tag-chips testID and forwards onChange', async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <TagsSection tags={['fantasy']} onChange={onChange} suggestions={['rogue']} />,
    );

    const chips = getByTestId('profile-tag-chips');
    expect(chips.props.tags).toEqual(['fantasy']);
    expect(chips.props.suggestions).toEqual(['rogue']);

    await act(async () => { chips.props.onChange(['fantasy', 'rogue']); });
    expect(onChange).toHaveBeenCalledWith(['fantasy', 'rogue']);
  });

  it('LifecycleSection forwards config/onChange to the LifecycleConfigEditor', async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <LifecycleSection config={{ autonomy_level: 2 }} onChange={onChange} />,
    );

    const editor = getByTestId('lifecycle-config-editor');
    expect(editor.props.config).toEqual({ autonomy_level: 2 });

    await act(async () => { editor.props.onChange({ autonomy_level: 3 }); });
    expect(onChange).toHaveBeenCalledWith({ autonomy_level: 3 });
  });

  it('AttributionSection wires creator / creator-notes / version inputs + badge', async () => {
    const onCreator = jest.fn();
    const onNotes = jest.fn();
    const onVersion = jest.fn();
    const { getByTestId } = await render(
      <AttributionSection
        creator="Someone"
        onChangeCreator={onCreator}
        creatorNotes="notes"
        onChangeCreatorNotes={onNotes}
        characterVersion="1.0"
        onChangeCharacterVersion={onVersion}
        cardProvenance={{ spec: 'chara_card_v3', spec_version: '3.0', source: ['https://x'] }}
      />,
    );

    expect(getByTestId('creator-input').props.value).toBe('Someone');
    expect(getByTestId('creator-notes-input').props.value).toBe('notes');
    expect(getByTestId('character-version-input').props.value).toBe('1.0');
    expect(getByTestId('creator-badge').props.creator).toBe('Someone');
    expect(getByTestId('creator-badge').props.source).toEqual(['https://x']);

    await fireEvent.changeText(getByTestId('creator-input'), 'Someone Else');
    expect(onCreator).toHaveBeenCalledWith('Someone Else');
    await fireEvent.changeText(getByTestId('character-version-input'), '2.0');
    expect(onVersion).toHaveBeenCalledWith('2.0');
  });

  it('ExportSection fires onExport(json|png) from the sheet', async () => {
    const onExport = jest.fn();
    const { getByTestId } = await render(<ExportSection onExport={onExport} />);

    await fireEvent.press(getByTestId('export-card-button'));
    expect(getByTestId('export-sheet')).toBeTruthy();

    await fireEvent.press(getByTestId('export-json'));
    expect(onExport).toHaveBeenCalledWith('json');

    await fireEvent.press(getByTestId('export-card-button'));
    await fireEvent.press(getByTestId('export-png'));
    expect(onExport).toHaveBeenCalledWith('png');
  });
});