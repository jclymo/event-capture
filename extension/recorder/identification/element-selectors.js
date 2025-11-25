// Element CSS and XPath selectors

// Get a CSS selector path to uniquely identify an element
export function getElementCssPath(element) {
  if (!element || element.nodeType !== 1) return '';
  
  let path = [];
  while (element && element.nodeType === 1) {
    let selector = element.tagName.toLowerCase();
    
    // If element has an ID, we can stop here - IDs are unique!
    if (element.id) {
      selector += '#' + element.id;
      path.unshift(selector);
      break;
    } else {
      // Add classes to make the selector more specific
      if (element.className && typeof element.className === 'string') {
        const classes = element.className.split(/\s+/).filter(c => c);
        if (classes.length > 0) {
          selector += '.' + classes.join('.');
        }
      }
      
      // Add position information if there are similar siblings
      let sibling = element, index = 1;
      while (sibling = sibling.previousElementSibling) {
        if (sibling.tagName === element.tagName) index++;
      }
      if (index > 1) selector += ':nth-of-type(' + index + ')';
      
      path.unshift(selector);
      element = element.parentNode;
    }
    
    // Keep the path reasonably short
    if (path.length > 5) break;
  }
  
  return path.join(' > ');
}

// Utility function to get element XPath
export function getElementXPath(element) {
  if (!element || element.nodeType !== 1) return '';
  
  if (element.id !== '') {
    return `//*[@id="${element.id}"]`;
  }
    // Handle document root
  if (element === document.documentElement) {
    return '/html';
  }
  
  if (element === document.body) {
    return '/html/body';
  }
  if (!element.parentNode) {
    return ''; // Detached element
  }
  
  let ix = 0;
  const siblings = element.parentNode.childNodes;
  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i];
    if (sibling === element) {
      const parentPath = getElementXPath(element.parentNode);
      const tagName = element.tagName.toLowerCase();
      const index = ix + 1;
      return `${parentPath}/${tagName}[${index}]`;
    }
    if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
      ix++;
    }
  }
}

