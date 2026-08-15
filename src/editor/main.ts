import './styles.css';
import { MapEditor } from './MapEditor';

const canvas = document.querySelector<HTMLCanvasElement>('#map-editor-canvas');
if (!canvas) throw new Error('Missing #map-editor-canvas element.');

const editor = new MapEditor(canvas);
editor.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => editor.dispose());
}
