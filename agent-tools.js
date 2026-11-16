/* Browser-side allow-listed tools for the DocuWorks AI agent.
   This file intentionally exposes only named application actions. */
(function (root) {
  'use strict';

  const TOOL_ROUTES = Object.freeze({
    home: 'index.html',
    cs: 'cs.html',
    project360: 'project360.html',
    scan: 'scan.html',
    pdf: 'ink-saver.html',
    priceReduction: 'price-reduction.html'
  });

  const APPROVAL_REQUIRED = new Set([
    'start_urs_cs_conversion',
    'create_cs_excel',
    'scan_export_pdf',
    'optimize_pdfs',
    'export_cleaned_pdf'
  ]);

  function byId(id) {
    return root.document ? root.document.getElementById(id) : null;
  }

  function visible(el) {
    if (!el) return false;
    if (typeof el.getClientRects === 'function') return el.getClientRects().length > 0;
    return true;
  }

  function getAvailableTools(page, doc) {
    const d = doc || root.document;
    const tools = ['inspect_current_tool', 'open_docuworks_tool'];
    if (!d) return tools;

    if (page === 'cs') {
      const button = d.getElementById('convert-btn');
      if (button && !button.disabled) {
        const label = String(button.textContent || '').trim();
        if (/^Convert & Review Rows$|^Retry (?:URS Inspection|AI Extraction)$/i.test(label)) {
          tools.push('start_urs_cs_conversion');
        }
        if (/Confirm Rows & Create CS Excel/i.test(label)) {
          tools.push('create_cs_excel');
        }
      }
    } else if (page === 'project360') {
      if (root.DocuWorksProject360 && typeof root.DocuWorksProject360.run === 'function') {
        tools.push('preview_project360_change');
      }
    } else if (page === 'scan') {
      const button = d.getElementById('bPdf');
      const pageGrid = d.getElementById('grid');
      if (button && !button.disabled && pageGrid && pageGrid.children && pageGrid.children.length > 0) tools.push('scan_export_pdf');
    } else if (page === 'pdf') {
      const button = d.getElementById('go');
      if (button && !button.disabled) tools.push('optimize_pdfs');
    } else if (page === 'priceReduction') {
      const button = d.getElementById('export');
      const editor = d.getElementById('editor');
      if (button && !button.disabled && editor && visible(editor)) tools.push('export_cleaned_pdf');
    }
    return tools;
  }

  function approvalRequired(name) {
    return APPROVAL_REQUIRED.has(String(name || ''));
  }

  function inspectCurrentTool() {
    const d = root.document;
    const main = d.querySelector('main') || d.querySelector('#app') || d.body;
    const fields = [];
    for (const el of Array.from(d.querySelectorAll('input,textarea,select'))) {
      if (el.type === 'password' || el.type === 'hidden' || el.type === 'file') continue;
      if (!visible(el)) continue;
      const label = el.labels && el.labels[0] ? el.labels[0].innerText :
        (el.getAttribute('aria-label') || el.name || el.id || el.tagName);
      const value = el.type === 'checkbox' ? (el.checked ? 'Yes' : 'No') : String(el.value || '').trim();
      if (value) fields.push({ label: String(label).trim(), value: value.slice(0, 500) });
    }
    const files = [];
    for (const el of Array.from(d.querySelectorAll('input[type="file"]'))) {
      for (const file of Array.from(el.files || [])) {
        files.push({ name: file.name, size: file.size, type: file.type || 'unknown' });
      }
    }
    const actions = Array.from(d.querySelectorAll('button'))
      .filter(visible)
      .slice(0, 40)
      .map(button => ({
        label: String(button.innerText || button.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        disabled: Boolean(button.disabled)
      }))
      .filter(button => button.label);
    const text = String(main && main.innerText || d.body.innerText || '')
      .replace(/\n{3,}/g, '\n\n')
      .slice(0, 6000);
    return {
      title: d.title,
      page: root.location ? root.location.pathname : '',
      visibleText: text,
      fields: fields.slice(0, 40),
      selectedFiles: files,
      availableActions: actions
    };
  }

  async function execute(name, args) {
    const a = args && typeof args === 'object' ? args : {};
    switch (name) {
      case 'inspect_current_tool':
        return inspectCurrentTool();

      case 'open_docuworks_tool': {
        const page = String(a.page || '').trim();
        const path = TOOL_ROUTES[page];
        if (!path) throw new Error('That DocuWorks page is not in the navigation allow-list.');
        if (!root.location) throw new Error('Page navigation is unavailable.');
        root.location.assign('./' + path);
        return { started: true, page, message: 'Opening ' + page + '.' };
      }

      case 'start_urs_cs_conversion': {
        const button = byId('convert-btn');
        if (!button || button.disabled || !/^Convert & Review Rows$|^Retry (?:URS Inspection|AI Extraction)$/i.test(String(button.textContent || '').trim())) {
          throw new Error('Select a URS PDF or DOCX first. The converter is not ready to start.');
        }
        button.click();
        return { started: true, message: 'The existing URS extraction workflow has started. Its progress and extracted-row review will appear on this page.' };
      }

      case 'create_cs_excel': {
        const button = byId('convert-btn');
        if (!button || button.disabled || !/Confirm Rows & Create CS Excel/i.test(String(button.textContent || ''))) {
          throw new Error('The extracted rows are not ready for export. Review the URS extraction first.');
        }
        button.click();
        return { started: true, message: 'The existing CS workbook generator was started. The Excel file will be downloaded by the browser when it finishes.' };
      }

      case 'preview_project360_change': {
        if (!root.DocuWorksProject360 || typeof root.DocuWorksProject360.run !== 'function') {
          throw new Error('Project 360 design controls are not available on this page.');
        }
        const instruction = String(a.instruction || '').trim().slice(0, 1600);
        if (!instruction) throw new Error('The design instruction is empty.');
        const result = await root.DocuWorksProject360.run(instruction);
        return { previewPrepared: true, message: String(result || 'The design preview was prepared.') };
      }

      case 'scan_export_pdf': {
        const button = byId('bPdf');
        const pageGrid = byId('grid');
        if (!button || button.disabled || !pageGrid || !pageGrid.children || pageGrid.children.length === 0) throw new Error('Add at least one scanned page before creating a PDF.');
        button.click();
        return { started: true, message: 'The scanner PDF action was opened. Complete any page-selection step shown by the scanner.' };
      }

      case 'optimize_pdfs': {
        const button = byId('go');
        if (!button || button.disabled) throw new Error('Select the PDF files and configure the optimizer first.');
        button.click();
        return { started: true, message: 'The existing PDF optimizer was started.' };
      }

      case 'export_cleaned_pdf': {
        const button = byId('export');
        const editor = byId('editor');
        if (!button || button.disabled || !editor || !visible(editor)) throw new Error('Open a PDF in the editing workspace before exporting it.');
        button.click();
        return { started: true, message: 'The existing cleaned-PDF export action was started.' };
      }

      default:
        throw new Error('The requested action is not available to the DocuWorks agent.');
    }
  }

  root.DocuWorksAgentTools = {
    routes: TOOL_ROUTES,
    getAvailableTools,
    approvalRequired,
    inspectCurrentTool,
    execute
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DocuWorksAgentTools;
})(typeof window !== 'undefined' ? window : globalThis);
