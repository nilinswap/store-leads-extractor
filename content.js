(async function () {
  console.log("Grid Scraper: Starting auto-scroll extraction...");

  // 1. Deep search to find the grid
  function findElementDeep(selector, root = document) {
    let element = root.querySelector(selector);
    if (element) return element;
    const allElements = root.querySelectorAll("*");
    for (let el of allElements) {
      if (el.shadowRoot) {
        let found = findElementDeep(selector, el.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  }

  const grid =
    findElementDeep("#domains") ||
    findElementDeep("vaadin-custom-grid") ||
    findElementDeep("vaadin-grid");
  if (!grid || !grid.shadowRoot) {
    alert("Could not locate the grid or its Shadow DOM.");
    return;
  }

  // Find the internal scrolling container and the table body
  const scroller =
    grid.shadowRoot.querySelector("#scroller") ||
    grid.shadowRoot.querySelector("table");
  const tbody = grid.shadowRoot.querySelector("tbody#items");
  const thead = grid.shadowRoot.querySelector("thead#header");

  if (!scroller || !tbody) {
    alert("Could not find the internal scroller.");
    return;
  }

  // Use a Map to ensure we don't grab duplicate rows as we scroll
  // Key will be the row index (aria-rowindex), Value will be the CSV string for that row
  const scrapedRows = new Map();
  let headers = "";

  // Helper function to extract data from a cell
  function extractCellData(cellElement) {
    const slot = cellElement.querySelector("slot");
    let cellText = [];
    let cellLinks = [];

    if (slot) {
      const assignedNodes = slot.assignedNodes({ flatten: true });
      assignedNodes.forEach((node) => {
        const text = node.textContent
          ? node.textContent.replace(/\s+/g, " ").trim()
          : "";
        if (text) cellText.push(text);

        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === "A" && node.href) cellLinks.push(node.href);
          node.querySelectorAll("a").forEach((a) => {
            if (a.href) cellLinks.push(a.href);
          });
        }
      });
    } else {
      cellText.push(cellElement.textContent.trim());
    }

    let finalString = cellText.join(" ").trim();
    if (cellLinks.length > 0) {
      const uniqueLinks = [...new Set(cellLinks)];
      finalString += ` (${uniqueLinks.join(", ")})`;
    }
    return `"${finalString.replace(/"/g, '""')}"`;
  }

  // 2. Grab Headers First
  if (thead) {
    const headerRow = thead.querySelector("tr");
    if (headerRow) {
      headers = Array.from(headerRow.querySelectorAll("th"))
        .map((th) => extractCellData(th))
        .join(",");
    }
  }

  // 3. Helper to scrape currently visible rows
  function scrapeCurrentView() {
    const rows = tbody.querySelectorAll("tr:not([hidden])");
    rows.forEach((tr) => {
      const rowIndex = tr.getAttribute("aria-rowindex");
      if (!rowIndex) return; // Skip if no index

      const rowData = Array.from(tr.querySelectorAll("td")).map((td) =>
        extractCellData(td),
      );

      // Only store if it has actual data
      if (rowData.some((cell) => cell !== '""')) {
        scrapedRows.set(rowIndex, rowData.join(","));
      }
    });
  }

  // 4. The Auto-Scrolling Logic
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let previousScrollTop = -1;
  let scrollAttempts = 0;

  // Scroll to the very top to start fresh
  scroller.scrollTop = 0;
  await sleep(1000);

  console.log("Beginning scroll loop...");

  while (true) {
    scrapeCurrentView();

    previousScrollTop = scroller.scrollTop;

    // Scroll down by roughly the height of the visible area
    scroller.scrollTop += scroller.clientHeight || 500;

    // Wait for Vaadin to fetch and render the new rows in the DOM
    // You may need to increase this to 1500 or 2000 if the grid is slow to load data
    await sleep(800);

    // If the scroll position didn't change, we've hit the bottom
    if (scroller.scrollTop === previousScrollTop) {
      scrollAttempts++;
      if (scrollAttempts >= 3) {
        console.log("Reached the bottom of the grid.");
        break; // Exit the loop after 3 failed attempts to scroll further
      }
    } else {
      scrollAttempts = 0; // Reset attempts if we successfully scrolled
    }
  }

  // 5. Sort and assemble the final CSV
  if (scrapedRows.size === 0) {
    alert("No data was extracted during the scroll.");
    return;
  }

  // Sort rows numerically by their aria-rowindex
  const sortedKeys = Array.from(scrapedRows.keys()).sort(
    (a, b) => parseInt(a) - parseInt(b),
  );
  const finalCsvRows = [];

  if (headers) finalCsvRows.push(headers);
  sortedKeys.forEach((key) => finalCsvRows.push(scrapedRows.get(key)));

  // 6. Download the file
  console.log(`Successfully scraped ${scrapedRows.size} unique rows.`);
  const csvString = finalCsvRows.join("\n");
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "vaadin_autoscroll_export.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
})();
