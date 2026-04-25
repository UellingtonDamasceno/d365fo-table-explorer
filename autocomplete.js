/* Reusable Autocomplete Component */
(function () {
  function createAutocomplete(input, options = {}) {
    const {
      getSuggestions, // (query) => string[]
      onSelect,       // (value) => void
      maxResults = 10,
      minChars = 1
    } = options;

    let currentFocus = -1;
    let suggestionsContainer = null;

    input.addEventListener('input', function() {
      const val = this.value;
      closeAllLists();
      if (!val || val.length < minChars) return false;
      currentFocus = -1;

      const suggestions = getSuggestions(val).slice(0, maxResults);
      if (suggestions.length === 0) return false;

      suggestionsContainer = document.createElement("DIV");
      suggestionsContainer.setAttribute("id", this.id + "autocomplete-list");
      suggestionsContainer.setAttribute("class", "autocomplete-items");
      this.parentNode.appendChild(suggestionsContainer);

      for (let i = 0; i < suggestions.length; i++) {
        const item = document.createElement("DIV");
        const match = suggestions[i];
        // Highlight match
        const reg = new RegExp("(" + val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ")", "gi");
        item.innerHTML = match.replace(reg, "<strong>$1</strong>");
        item.innerHTML += "<input type='hidden' value='" + match + "'>";
        
        item.addEventListener("click", function() {
          input.value = this.getElementsByTagName("input")[0].value;
          closeAllLists();
          if (onSelect) onSelect(input.value);
        });
        suggestionsContainer.appendChild(item);
      }
    });

    input.addEventListener("keydown", function(e) {
      let x = document.getElementById(this.id + "autocomplete-list");
      if (x) x = x.getElementsByTagName("div");
      if (e.keyCode == 40) { // DOWN
        currentFocus++;
        addActive(x);
      } else if (e.keyCode == 38) { // UP
        currentFocus--;
        addActive(x);
      } else if (e.keyCode == 13) { // ENTER
        if (currentFocus > -1) {
          if (x) x[currentFocus].click();
          e.preventDefault();
        }
      }
    });

    function addActive(x) {
      if (!x) return false;
      removeActive(x);
      if (currentFocus >= x.length) currentFocus = 0;
      if (currentFocus < 0) currentFocus = (x.length - 1);
      x[currentFocus].classList.add("autocomplete-active");
      // Ensure visible
      x[currentFocus].scrollIntoView({ block: 'nearest' });
    }

    function removeActive(x) {
      for (let i = 0; i < x.length; i++) {
        x[i].classList.remove("autocomplete-active");
      }
    }

    function closeAllLists(elmnt) {
      const x = document.getElementsByClassName("autocomplete-items");
      for (let i = 0; i < x.length; i++) {
        if (elmnt != x[i] && elmnt != input) {
          x[i].parentNode.removeChild(x[i]);
        }
      }
    }

    document.addEventListener("click", function (e) {
      closeAllLists(e.target);
    });

    return {
      destroy: () => {
        closeAllLists();
        // Additional cleanup if needed
      }
    };
  }

  window.D365Autocomplete = { create: createAutocomplete };
})();
