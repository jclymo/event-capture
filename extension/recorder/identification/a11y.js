// Accessibility identifiers

// Simple function to get accessibility identifiers for an element
export function getA11yIdentifiers(element) {
  if (!element) return {};
  
  return {
    // Role is the most important identifier in the a11y tree
    role: element.getAttribute('role') || getImplicitRole(element),
    
    // Name is how the element is announced (crucial for identification)
    name: getAccessibleName(element),
    
    // Basic path through the a11y tree (for locating in the tree)
    path: getSimpleA11yPath(element),
    
    // Additional identifiers that help locate the element
    id: element.id || '',
    tagName: element.tagName.toLowerCase()
  };
}

// Get a simple path through the accessibility tree
function getSimpleA11yPath(element) {
  if (!element) return '';
  
  const path = [];
  let current = element;
  let depth = 0;
  const MAX_DEPTH = 5; // Limit path depth to avoid excessive length
  
  while (current && current.nodeType === 1 && depth < MAX_DEPTH) {
    const role = current.getAttribute('role') || getImplicitRole(current);
    const name = getAccessibleName(current);
    
    let pathSegment = role || current.tagName.toLowerCase();
    if (name) {
      // Include name but keep it short
      const shortName = name.length > 25 ? name.substring(0, 25) + '...' : name;
      pathSegment += `[${shortName}]`;
    }
    
    path.unshift(pathSegment);
    current = current.parentElement;
    depth++;
  }
  
  return path.join(' > ');
}

// Simple function to get accessible name
function getAccessibleName(element) {
  // Check common name sources in priority order
  return element.getAttribute('aria-label') || 
         element.getAttribute('alt') || 
         element.getAttribute('title') || 
         element.textContent.trim().substring(0, 50) || '';
}

// Simple function to determine implicit role
function getImplicitRole(element) {
  const tagName = element.tagName.toLowerCase();
  
  // Very simplified mapping of common elements to roles
  const simpleRoleMap = {
    'a': 'link',
    'button': 'button',
    'h1': 'heading',
    'h2': 'heading',
    'h3': 'heading',
    'input': 'textbox',
    'select': 'combobox',
    'textarea': 'textbox',
    'img': 'img',
    'ul': 'list',
    'ol': 'list',
    'li': 'listitem'
  };
  
  return simpleRoleMap[tagName] || '';
}

