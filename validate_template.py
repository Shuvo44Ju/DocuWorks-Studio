"""Compare a generated CS workbook with the original CS.xlsx template. Exit code 1 on any structural change."""
import sys, openpyxl
tpl_path, out_path = sys.argv[1], sys.argv[2]
T = openpyxl.load_workbook(tpl_path); O = openpyxl.load_workbook(out_path)
errs = []
def fp(c):
    b=c.border; f=c.font; a=c.alignment
    return (f.name, f.sz, bool(f.b), f.color.rgb if f.color and f.color.type=='rgb' else None,
            c.fill.fgColor.rgb if c.fill and c.fill.fill_type else None,
            tuple((getattr(b,k).style if getattr(b,k) else None) for k in ('left','right','top','bottom')),
            a.horizontal, a.vertical, bool(a.wrap_text))
if T.sheetnames != O.sheetnames: errs.append(f'sheet names differ: {T.sheetnames} vs {O.sheetnames}')
t, o = T['CS'], O['CS']
for col in 'ABCD':
    if abs((t.column_dimensions[col].width or 0)-(o.column_dimensions[col].width or 0))>0.5: errs.append(f'col {col} width changed')
for name in ('freeze_panes',): 
    if getattr(t,name)!=getattr(o,name): errs.append(f'{name} changed')
if t.sheet_view.zoomScale!=o.sheet_view.zoomScale: errs.append('zoom changed')
if t.sheet_view.showGridLines!=o.sheet_view.showGridLines: errs.append('gridlines changed')
if t.page_setup.orientation!=o.page_setup.orientation: errs.append('orientation changed')
for r in range(2,8):                       # rows 2-7 must be byte-identical in value and style
    for c in (1,2,3):
        a,b=t.cell(r,c),o.cell(r,c)
        if a.value!=b.value: errs.append(f'{a.coordinate} value changed {a.value!r}->{b.value!r}')
        if fp(a)!=fp(b): errs.append(f'{a.coordinate} style changed')
if fp(t['A1'])!=fp(o['A1']): errs.append('A1 style changed')
if 'A1:C1' not in [str(m) for m in o.merged_cells.ranges]: errs.append('A1:C1 no longer merged')
sec_fp=[fp(t.cell(8,c)) for c in (1,2,3)]; body_fp=[fp(t.cell(9,c)) for c in (1,2,3)]
merged_rows={m.min_row for m in o.merged_cells.ranges if m.min_row>=8}
n_sec=n_body=0
for r in range(8,o.max_row+1):
    a=o.cell(r,1); b=o.cell(r,2)
    if a.value is None and b.value is None and o.cell(r,3).value is None: continue
    if r in merged_rows:
        n_sec+=1
        if [fp(o.cell(r,c)) for c in (1,2,3)]!=sec_fp: errs.append(f'row {r}: section style differs from template row 8')
    else:
        n_body+=1
        if [fp(o.cell(r,c)) for c in (1,2,3)]!=body_fp: errs.append(f'row {r}: body style differs from template row 9')
    if o.cell(r,4).value is not None: errs.append(f'row {r}: data written outside A:C')
print(f'sections={n_sec} body_rows={n_body} errors={len(errs)}')
for e in errs[:25]: print(' -',e)
sys.exit(1 if errs else 0)
