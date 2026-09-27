import { useEffect, useState } from 'react';
import { FileText, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { payrollService } from '../../../services/payrollService.js';
import CrewMobileDetailHeader from './CrewMobileDetailHeader.jsx';
import CrewBottomSheet from './CrewBottomSheet.jsx';
import { CrewMobilePage, CrewPageSection, CrewEmptyState } from './CrewMobileUI.jsx';
import './CrewEmploymentDocumentsMobile.css';

export default function CrewPayslipsMobile({ token,onBack }) {
 const {t,i18n}=useTranslation();
 const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[detail,setDetail]=useState(null),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setRows([]);setDetail(null);setError('');setLoading(true);
  payrollService.crewPayslips(token).then(data=>{if(active)setRows(data.payslips || []);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[token,retry]);
 async function open(row) {setBusy(true);setError('');try{const pdf=await payrollService.openPayslip({token,periodId:row.period_id});setDetail({...row,...pdf});}catch(e){setError(e.message || t('payslips.error'));}finally{setBusy(false);}}
 const period=row=>new Intl.DateTimeFormat(i18n.resolvedLanguage==='zh'?'zh-MY':i18n.resolvedLanguage==='ms'?'ms-MY':'en-MY',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${row.period_start}T00:00:00Z`));
 const money=value=>new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format(Number(value));
 return <CrewMobilePage><CrewMobileDetailHeader title={t('payslips.title')} onBack={onBack} /><CrewPageSection>
  {loading && <div className="crew-v2-state" role="status">{t('common.loading')}</div>}
  {error && <div className="crew-v2-error" role="alert">{error}<button type="button" onClick={()=>setRetry(value=>value+1)}>{t('common.retry')}</button></div>}
  {!loading && !error && !rows.length && <CrewEmptyState title={t('payslips.empty')} body={t('payslips.emptyBody')} />}
  <div className="crew-employment-document-list">{rows.map(row=><article key={row.period_id} className="crew-ui-functional-surface"><header><span className="crew-ui-icon-container"><FileText size={20} /></span><div><h2>{period(row)}</h2><p>{t('payslips.net')} · {money(row.net_pay)}</p></div></header>
   <button type="button" className="crew-mobile-secondary" disabled={busy || !row.available} onClick={()=>open(row)}>{row.available?t('payslips.view'):t('payslips.unavailable')}</button></article>)}</div>
 </CrewPageSection>
 {detail && <CrewBottomSheet title={period(detail)} onClose={()=>setDetail(null)} footer={<button type="button" className="crew-mobile-secondary" onClick={()=>open(detail)}>{t('payslips.refresh')}</button>}>
  <iframe title={t('payslips.title')} className="crew-employment-document-pdf" src={detail.document_url} />
  <a className="crew-mobile-secondary" href={detail.download_url} target="_blank" rel="noreferrer"><Download size={18} />{t('payslips.download')}</a>
 </CrewBottomSheet>}
 </CrewMobilePage>;
}
