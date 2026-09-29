import { renderChat, renderScope } from "../ai/chat.js";
import { updateDl } from "../app/files.js";
import { S } from "../state.js";
import { renderChanges } from "./changes.js";
import { renderDiagram } from "./diagram.js";
import { renderMindmap } from "./mindmap.js";
import { renderOutline } from "./outline.js";
import { renderDetail, renderSideStatic, renderSummary } from "./side.js";
import { renderSource } from "./source.js";
import { renderSuggest } from "./suggestions.js";

export function renderAll() {
  renderSummary();
  renderDiagram();
  renderOutline();
  renderSideStatic();
  renderDetail();
  updateDl();
  renderScope();
  if (S.tab === "mindmap") renderMindmap();
  if (S.tab === "source") renderSource();
  if (S.tab === "suggest") renderSuggest();
  renderChanges();
  if (S.side === "chat") renderChat();
}
