import {useState} from 'react';
import type {AppController} from '../types';
import {clearTelemetry,exportableEvents,isTelemetryEnabled,recordEvent,setTelemetryEnabled} from '../lib/telemetry';
import {PENDING_STORAGE_KEY,validatePending} from '../lib/pending';
import {exportJson,Notice} from './shared';
import { i18nText } from "../lib/i18n";
export function PendingWarning({controller:c}:{controller:AppController}){
 const [checked,setChecked]=useState(false),[note,setNote]=useState('');
 if(!c.pendingWarning)return null;
 function backup(){try{exportJson('FAIRJOIN-pending-record-backup.json',{warning:'This is a local diagnostic record, not proof of payment. It can be modified. Verify on chain.',raw:localStorage.getItem(PENDING_STORAGE_KEY)});setNote(i18nText('已导出本地记录。'));}catch{setNote(i18nText('浏览器存储不可读，请先检查钱包交易历史。'));}}
 function clear(){if(!checked||c.pending)return;try{const text=localStorage.getItem(PENDING_STORAGE_KEY);let valid=false;try{valid=Boolean(text&&validatePending(JSON.parse(text)))}catch{}if(valid){setNote(i18nText('记录现在是有效待核实交易，不能通过此入口清除，请恢复原交易。'));return;}localStorage.removeItem(PENDING_STORAGE_KEY);window.location.reload();}catch{setNote(i18nText('本地存储仍不可用，未解除写入保护。'));}}
 return <Notice tone="danger" role="alert"><strong>{i18nText("本地交易记录需要人工核对。")}</strong><p>{c.pendingWarning}</p><p>{i18nText("已暂停新签名。链上交易不会因为清除浏览器记录而取消。")}</p><details><summary>{i18nText("备份并处理损坏的本地记录")}</summary><button className="secondary" onClick={backup}>{i18nText("导出原始记录")}</button><label className="consent"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/><span>{i18nText("我已在原钱包核对所有待处理交易；理解这里只清除损坏的本地记录，不会取消链上交易。")}</span></label><button className="secondary" disabled={!checked||Boolean(c.pending)} onClick={clear}>{i18nText("清除损坏记录并重新读取")}</button><p role="status">{note}</p></details></Notice>;
}
export function Diagnostics({controller:c}:{controller:AppController}){
 const [enabled,setEnabled]=useState(isTelemetryEnabled),[note,setNote]=useState('');
 return <details className="telemetry-controls"><summary>{i18nText("网络与本地体验记录")}</summary><p className="fine">{i18nText("只在本机记录，不上传服务器；默认关闭，不记录钱包地址、私钥或输入的活动内容。")}</p><label><input type="checkbox" checked={enabled} onChange={e=>{const on=e.target.checked;setTelemetryEnabled(on);setEnabled(on);if(on)recordEvent('page_view',{chainId:c.deployment?.chainId,groupId:c.snapshot?.group.id.toString()});}}/>{i18nText("启用本地体验记录")}</label><div className="utility-actions"><button className="secondary" onClick={()=>exportJson('FAIRJOIN-local-events.json',{localOnly:true,enabled,events:exportableEvents()})}>{i18nText("导出本地体验记录")}</button><button className="text-button" onClick={()=>{clearTelemetry();setNote(i18nText('本地体验记录已清空。'));}}>{i18nText("清空体验记录")}</button></div><p role="status">{note}</p>{c.rpcStatus&&<div className="fine"><strong>{i18nText("最近一次 RPC 身份检查")}</strong>{c.rpcStatus.endpoints.map(e=><p key={e.url}>{new URL(e.url).host} · {e.ok?i18nText('网络身份匹配'):i18nText('暂不可用或身份不匹配')}</p>)}<p>{i18nText("这里只读切换节点；钱包广播不会自动重发。最后检查")} {new Date(c.rpcStatus.checkedAt).toLocaleString('zh-CN')}。</p></div>}</details>;
}
