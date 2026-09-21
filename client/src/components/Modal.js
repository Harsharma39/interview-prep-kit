import { useEffect, useRef } from 'react';
import './Modal.css';
export default function Modal({ title, children, onClose, busy }) {
 const ref=useRef(); useEffect(()=>ref.current?.focus(),[]); useEffect(()=>{const fn=e=>{if(e.key==='Escape'&&!busy)onClose()};window.addEventListener('keydown',fn);return()=>window.removeEventListener('keydown',fn)},[busy,onClose]);
 return <div className="modal-backdrop" onMouseDown={()=>!busy&&onClose()}><section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="kit-modal-title" onMouseDown={e=>e.stopPropagation()}><div className="modal-heading"><h2 id="kit-modal-title">{title}</h2><button ref={ref} type="button" className="text-button" disabled={busy} onClick={onClose}>Close</button></div>{children}</section></div>;
}
