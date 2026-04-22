export function Box({ title, children, style, className = '' }) {
  return (
    <div className={`box ${className}`} style={style}>
      <div className="box-header">
        <span className="box-bracket">[</span>
        <span className="box-title accent1">{title}</span>
        <span className="box-bracket">]</span>
      </div>
      <div className="box-body">{children}</div>
    </div>
  );
}
