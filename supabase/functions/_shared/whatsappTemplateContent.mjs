export const templateNamePattern = /^[a-z0-9_]{1,512}$/;
export const templateLanguagePattern = /^[a-z]{2,3}(?:_[A-Za-z]{2,8}){0,2}$/;
export const templateCategories = ['UTILITY', 'MARKETING'];
export const templateButtonTypes = ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'];

export function numberedVariables(text) {
  return [...new Set([...text.matchAll(/{{([1-9]\d*)}}/g)].map(match => match[1]))];
}

function variablesValid(text, variables, limit) {
  return !/[{}]/.test(text.replace(/{{[1-9]\d*}}/g, ''))
    && variables.length <= limit && variables.every((value, index) => value === String(index + 1));
}

function sampleValid(sample) {
  return typeof sample === 'string' && Boolean(sample.trim()) && sample.length <= 100;
}

export function compileTemplateBody(text, samples) {
  if (typeof text !== 'string' || !text.trim() || text.length > 1024 || !Array.isArray(samples)) {
    return {error:'whatsapp_template_invalid'};
  }
  const variables = numberedVariables(text);
  if (!variablesValid(text, variables, 10) || samples.length !== variables.length || !samples.every(sampleValid)) {
    return {error:'whatsapp_template_variables_invalid'};
  }
  return {body:{type:'BODY',text:text.trim(),...(samples.length?{example:{body_text:[samples.map(sample=>sample.trim())]}}:{})}};
}

export function compileTemplateComponents(input) {
  const result = compileTemplateBody(input?.text, input?.samples);
  if (result.error) return result;
  const {header='', headerSample='', footer='', buttons=[]} = input;
  if (typeof header !== 'string' || header.length > 60 || typeof footer !== 'string'
    || footer.length > 60 || /[{}]/.test(footer) || !Array.isArray(buttons) || buttons.length > 3) {
    return {error:'whatsapp_template_components_invalid'};
  }
  const variables = numberedVariables(header);
  if (!variablesValid(header, variables, 1) || (variables.length && !sampleValid(headerSample))) {
    return {error:'whatsapp_template_header_variables_invalid'};
  }

  const compiledButtons = [];
  for (const button of buttons) {
    if (!templateButtonTypes.includes(button?.type) || typeof button.text !== 'string'
      || !button.text.trim() || button.text.length > 25 || /[{}]/.test(button.text)) {
      return {error:'whatsapp_template_buttons_invalid'};
    }
    const item = {type:button.type, text:button.text.trim()};
    if (button.type === 'URL') {
      const value = typeof button.url === 'string' ? button.url.trim() : '';
      let url;
      try { url = new URL(value); } catch { return {error:'whatsapp_template_buttons_invalid'}; }
      if (url.protocol !== 'https:' || url.username || url.password || /[{}\s]/.test(value) || value.length > 2000) {
        return {error:'whatsapp_template_buttons_invalid'};
      }
      item.url = value;
    }
    if (button.type === 'PHONE_NUMBER') {
      if (typeof button.phone_number !== 'string' || !/^\+[1-9]\d{6,14}$/.test(button.phone_number)) {
        return {error:'whatsapp_template_buttons_invalid'};
      }
      item.phone_number = button.phone_number;
    }
    compiledButtons.push(item);
  }
  const types = compiledButtons.map(button=>button.type);
  if (types.filter(type=>type==='URL').length>2 || types.filter(type=>type==='PHONE_NUMBER').length>1
    || new Set(compiledButtons.map(button=>button.text.toLowerCase())).size!==types.length
    || (types.includes('QUICK_REPLY')&&types.some(type=>type!=='QUICK_REPLY'))) {
    return {error:'whatsapp_template_buttons_invalid'};
  }
  return {components:[
    ...(header.trim()?[{type:'HEADER',format:'TEXT',text:header.trim(),...(variables.length?{example:{header_text:[headerSample.trim()]}}:{})}]:[]),
    result.body,
    ...(footer.trim()?[{type:'FOOTER',text:footer.trim()}]:[]),
    ...(compiledButtons.length?[{type:'BUTTONS',buttons:compiledButtons}]:[]),
  ]};
}

export const templateValidationMessages = {
  whatsapp_template_invalid:'Enter a message body of 1–1,024 characters.',
  whatsapp_template_variables_invalid:'Number body variables in order and provide one sample for each.',
  whatsapp_template_components_invalid:'Use a text header and footer of up to 60 characters each. The footer cannot contain variables.',
  whatsapp_template_header_variables_invalid:'Use at most {{1}} in the header and provide its sample.',
  whatsapp_template_buttons_invalid:'Use up to three quick replies or website and call buttons. Use unique labels, HTTPS links and international phone numbers.',
};
