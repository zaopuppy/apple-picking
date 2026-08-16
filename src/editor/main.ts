import './styles.css';
import { MapEditor } from './MapEditor';

const canvas = document.querySelector<HTMLCanvasElement>('#map-editor-canvas');
const previewCanvas = document.querySelector<HTMLCanvasElement>('#map-preview-canvas');
const previewStatus = document.querySelector<HTMLElement>('#preview-status');
if (!canvas || !previewCanvas || !previewStatus) throw new Error('Missing map editor canvas elements.');

const editor = new MapEditor(canvas, previewCanvas, previewStatus);
editor.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => editor.dispose());
}
