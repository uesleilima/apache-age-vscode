import * as vscode from 'vscode';
import { QueryResult, extractGraphElements, AgeVertex, AgeEdge, gidToString } from '../core/query/QueryResult';

/**
 * Manages the graph visualization webview panel using Cytoscape.js.
 */
export class GraphViewPanel {
  public static currentPanel: GraphViewPanel | undefined;
  private static readonly viewType = 'ageGraphView';

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.panel.onDidDispose(() => {
      GraphViewPanel.currentPanel = undefined;
    });
  }

  /**
   * Show or reuse the graph panel.
   */
  static show(extensionUri: vscode.Uri, result: QueryResult, query: string): GraphViewPanel {
    const column = vscode.ViewColumn.Beside;

    if (GraphViewPanel.currentPanel) {
      GraphViewPanel.currentPanel.panel.reveal(column, true);
      GraphViewPanel.currentPanel.update(result, query);
      return GraphViewPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      GraphViewPanel.viewType,
      'AGE Graph',
      { viewColumn: column, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );

    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'age-icon.svg');

    GraphViewPanel.currentPanel = new GraphViewPanel(panel, extensionUri);
    GraphViewPanel.currentPanel.update(result, query);
    return GraphViewPanel.currentPanel;
  }

  update(result: QueryResult, query: string): void {
    const { vertices, edges } = extractGraphElements(result.rows);
    this.panel.title = `AGE Graph (${vertices.length}N, ${edges.length}E)`;
    this.panel.webview.html = this.getHtml(vertices, edges, query);
  }

  private getHtml(vertices: AgeVertex[], edges: AgeEdge[], query: string): string {
    const nonce = getNonce();

    const nodes = vertices.map((v) => ({
      data: {
        id: vertexId(v),
        label: v.label,
        properties: v.properties,
        displayLabel: nodeDisplayLabel(v),
        displayProps: formatProps(v.properties),
      },
    }));

    const edgeElements = edges.map((e) => ({
      data: {
        id: edgeId(e),
        source: vertexIdFromGid(e.start_id),
        target: vertexIdFromGid(e.end_id),
        label: e.label,
        properties: e.properties,
        displayLabel: `:${e.label}`,
      },
    }));

    const elements = JSON.stringify({ nodes, edges: edgeElements });

    // Use CDN for Cytoscape.js — avoids bundling a large library
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src 'nonce-${nonce}';
                 script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com;
                 connect-src https://cdnjs.cloudflare.com;" />
  <style nonce="${nonce}">
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border);
      --header-bg: var(--vscode-sideBar-background);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--fg);
      background: var(--bg);
      overflow: hidden;
    }
    #toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      background: var(--header-bg);
      font-size: 0.85em;
    }
    #toolbar .info { flex: 1; opacity: 0.8; }
    #toolbar button {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      padding: 3px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.85em;
    }
    #toolbar button:hover { background: var(--btn-hover); }
    #toolbar select {
      background: var(--header-bg);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 3px;
      padding: 2px 6px;
      font-size: 0.85em;
    }
    #cy {
      width: 100%;
      height: calc(100vh - 42px);
    }
    #legend {
      position: absolute;
      top: 50px;
      left: 12px;
      background: var(--header-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 0.8em;
      display: none;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    #legend .legend-title { font-weight: bold; margin-bottom: 4px; opacity: 0.7; }
    #legend .legend-item { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
    #legend .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    #details {
      position: absolute;
      bottom: 12px;
      right: 12px;
      max-width: 320px;
      max-height: 200px;
      overflow: auto;
      background: var(--header-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 0.82em;
      display: none;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    #details h4 { margin-bottom: 6px; }
    #details .prop { margin: 2px 0; }
    #details .key { opacity: 0.7; }
    .no-graph {
      display: flex;
      align-items: center;
      justify-content: center;
      height: calc(100vh - 42px);
      opacity: 0.5;
      font-size: 1.1em;
    }
  </style>
</head>
<body>
  <div id="toolbar">
    <div class="info" id="stats"></div>
    <label for="layoutSelect">Layout:</label>
    <select id="layoutSelect">
      <option value="cose" selected>Force-directed</option>
      <option value="circle">Circle</option>
      <option value="grid">Grid</option>
      <option value="breadthfirst">Hierarchy</option>
      <option value="concentric">Concentric</option>
    </select>
    <button id="btnFit">Fit</button>
    <button id="btnPng">PNG</button>
  </div>
  <div id="cy"></div>
  <div id="legend"></div>
  <div id="details"></div>

  <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.30.4/cytoscape.min.js"></script>
  <script nonce="${nonce}">
    const elements = ${elements};
    const statsEl = document.getElementById('stats');
    const detailsEl = document.getElementById('details');

    if (elements.nodes.length === 0) {
      document.getElementById('cy').innerHTML = '<div class="no-graph">No graph elements in result</div>';
      statsEl.textContent = '0 nodes, 0 edges';
    } else {
      statsEl.textContent = elements.nodes.length + ' nodes, ' + elements.edges.length + ' edges';

      // Color palette for labels
      const labelColors = {};
      const palette = [
        '#4CAF50', '#2196F3', '#FF9800', '#E91E63', '#9C27B0',
        '#00BCD4', '#FF5722', '#795548', '#607D8B', '#8BC34A',
        '#3F51B5', '#FFEB3B', '#009688', '#F44336', '#CDDC39',
      ];
      let colorIdx = 0;
      function getColor(label) {
        if (!labelColors[label]) {
          labelColors[label] = palette[colorIdx % palette.length];
          colorIdx++;
        }
        return labelColors[label];
      }

      // Assign colors
      elements.nodes.forEach(n => {
        n.data.color = getColor(n.data.label);
      });
      elements.edges.forEach(e => {
        e.data.color = getColor(e.data.label);
      });

      // Build legend
      const legendEl = document.getElementById('legend');
      const nodeLabels = [...new Set(elements.nodes.map(n => n.data.label))];
      if (nodeLabels.length > 0) {
        let html = '<div class="legend-title">Node Types</div>';
        nodeLabels.forEach(l => {
          html += '<div class="legend-item"><span class="legend-dot" data-color="' + getColor(l) + '"></span>' + l + '</div>';
        });
        legendEl.innerHTML = html;
        legendEl.querySelectorAll('.legend-dot').forEach(dot => {
          dot.style.backgroundColor = dot.getAttribute('data-color');
        });
        legendEl.style.display = 'block';
      }

      const cy = cytoscape({
        container: document.getElementById('cy'),
        elements: elements,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': 'data(color)',
              'label': 'data(displayLabel)',
              'color': '#fff',
              'text-outline-color': 'data(color)',
              'text-outline-width': 2,
              'font-size': '9px',
              'text-valign': 'center',
              'text-halign': 'center',
              'text-wrap': 'wrap',
              'text-max-width': '60px',
              'text-overflow-wrap': 'anywhere',
              'width': 50,
              'height': 50,
            }
          },
          {
            selector: 'edge',
            style: {
              'width': 2,
              'line-color': 'data(color)',
              'target-arrow-color': 'data(color)',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              'label': 'data(displayLabel)',
              'font-size': '9px',
              'text-rotation': 'autorotate',
              'color': 'data(color)',
              'text-outline-color': 'var(--bg, #1e1e1e)',
              'text-outline-width': 1,
              'opacity': 0.8,
            }
          },
          {
            selector: ':selected',
            style: {
              'border-width': 3,
              'border-color': '#fff',
            }
          },
        ],
        layout: { name: 'cose', animate: true, animationDuration: 500 },
      });

      // Show details on tap
      cy.on('tap', 'node, edge', function(evt) {
        const data = evt.target.data();
        let html = '<h4>' + data.displayLabel + '</h4>';
        if (data.properties) {
          for (const [k, v] of Object.entries(data.properties)) {
            html += '<div class="prop"><span class="key">' + k + ':</span> ' + JSON.stringify(v) + '</div>';
          }
        }
        detailsEl.innerHTML = html;
        detailsEl.style.display = 'block';
      });

      cy.on('tap', function(evt) {
        if (evt.target === cy) detailsEl.style.display = 'none';
      });

      // Layout switcher
      document.getElementById('layoutSelect').addEventListener('change', function(e) {
        cy.layout({ name: e.target.value, animate: true, animationDuration: 500 }).run();
      });

      // Fit button
      document.getElementById('btnFit').addEventListener('click', function() {
        cy.fit(undefined, 30);
      });

      // PNG export
      document.getElementById('btnPng').addEventListener('click', function() {
        const dataUrl = cy.png({ full: true, scale: 2, bg: getComputedStyle(document.body).backgroundColor });
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'graph.png';
        a.click();
      });
    }
  </script>
</body>
</html>`;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function vertexId(v: AgeVertex): string {
  return gidToString(v.id);
}

function vertexIdFromGid(gid: unknown): string {
  if (typeof gid === 'object' && gid !== null && 'oid' in gid && 'id' in gid) {
    const g = gid as { oid: number; id: number };
    return `${g.oid}.${g.id}`;
  }
  return String(gid);
}

function edgeId(e: AgeEdge): string {
  return `e_${gidToString(e.id)}`;
}

function formatProps(props: Record<string, unknown>): string {
  const entries = Object.entries(props);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
}

/** Common property names used as a display name for nodes, checked in priority order. */
const DISPLAY_NAME_KEYS = ['name', 'title', 'label', 'description', 'key', 'code', 'id'];

function nodeDisplayLabel(v: AgeVertex): string {
  for (const key of DISPLAY_NAME_KEYS) {
    const val = v.properties[key];
    if (val !== undefined && val !== null && val !== '') {
      if (typeof val === 'object') continue;
      const str = String(val);
      return str.length > 30 ? str.slice(0, 27) + '...' : str;
    }
  }
  return `:${v.label}`;
}
