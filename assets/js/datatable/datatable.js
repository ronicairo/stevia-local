let filters = JSON.parse(localStorage.getItem('filters')) || {}
let getSoldesXMLHttpRequest = new XMLHttpRequest();
let alreadyAlerted = false;

const u = new URL(location.href);
if (u.searchParams.get('dtclear') === '1') {
    localStorage.removeItem('dt:last');
    u.searchParams.delete('dtclear');
    history.replaceState({}, '', u.pathname + (u.search || '') + (u.hash || ''));
}

window.addEventListener('DOMContentLoaded', function () {

    clearButtonAction();

    document.querySelectorAll('.data-table thead .filter-value').forEach(el => {
        const inputName = el.name
        const tableId = el.closest('table').id

        // Pour les filtres en local storage
        if (Object.keys(filters).includes(tableId)) {
            el.value = Object.keys(filters[tableId]).includes(inputName) ? filters[tableId][inputName].value : ''
        }
    })

    document.querySelectorAll('.data-table thead .filter-operator').forEach(el => {
        const inputName = el.name.replace('_operator', '')
        const tableId = el.closest('table').id

        // Pour les filtres en local storage
        if (Object.keys(filters).includes(tableId)) {
            el.value = Object.keys(filters[tableId]).includes(inputName)
                ? filters[tableId][inputName].operator
                : el.options[0].value
        }
    })

    // Empêcher les saisies non numériques sur les input number
    document.querySelectorAll('table input[type="number"]').forEach(el => {
        el.addEventListener("keydown", function (event) {
            const specialKeys = ['Backspace', 'Tab', 'ArrowLeft', 'ArrowRight', 'Delete', 'Enter']

            if (!Number.isInteger(Number(event.key)) && !specialKeys.includes(event.key)) {
                event.preventDefault()
            }
        })
    })
    // Récupère le dernier tableau consulté et l'envoi au bouton back-to-list
    const a = document.getElementById('back-to-list');
    const last = localStorage.getItem('dt:last');
    if (a && last && last.startsWith('/')) {
        const backUrl = new URL(a.href, location.origin);
        const u  = new URL(last, location.origin);
        u.searchParams.set('_t', Date.now());
        u.searchParams.set('dtclear', '1');

        backUrl.searchParams.set('redirect', u.pathname + u.search + u.hash);
        a.href = backUrl.pathname + backUrl.search + backUrl.hash;
    }
})
const rememberDataTable = table => {
    const remember = () => localStorage.setItem('dt:last', location.pathname + location.search);
    remember();
    table.off('draw.dt.dtRemember').on('draw.dt.dtRemember', remember);
};


const initializeFilters = table => {
    // Déplace les filtres pour un bel affichage
    document.querySelectorAll('.data-table thead th').forEach(el => {
        const fragment = document.createDocumentFragment()
        const containerEl = el.querySelector('.container')

        if (containerEl) {
            fragment.appendChild(containerEl)
            el.appendChild(fragment)
        }
    })

    let typingTimer
    $(table.table().container()).on('keyup change', 'thead input, thead select', function (event) {
        if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
        clearTimeout(typingTimer)

        typingTimer = setTimeout(() => {
            const currentElement = this;
            const tableId = table.table().node().id

            let inputValueElement;
            let operatorValue;
            let key;

            if ($(currentElement).hasClass('filter-operator')) {
                inputValueElement = currentElement.closest('.container').querySelector('.filter-value');
                operatorValue = currentElement.value;
                key = inputValueElement.name;
            } else {
                inputValueElement = currentElement;
                const operatorInput = currentElement.closest('.container').querySelector('.filter-operator');
                operatorValue = operatorInput ? operatorInput.value : '=';
                key = currentElement.name;
            }

            // Capture l'état actuel pour comparaison
            const previousFilterState = filters[tableId] && filters[tableId][key] ? {...filters[tableId][key]} : null;

            if (!filters[tableId]) filters[tableId] = {}

            let changed = false; // Indicateur pour savoir si un changement significatif a eu lieu

            // Mise à jour de l'état local des filtres
            if (inputValueElement.value.trim() !== '') {
                const newFilterData = {
                    value: inputValueElement.value.trim(),
                    operator: operatorValue,
                    type: inputValueElement.getAttribute('data-type')
                };
                // Vérifie si le filtre a réellement changé (valeur ou opérateur)
                if (!previousFilterState ||
                    previousFilterState.value !== newFilterData.value ||
                    previousFilterState.operator !== newFilterData.operator) {
                    filters[tableId][key] = newFilterData;
                    changed = true;
                }
            } else {
                // On traite ici le cas d'une valeur d'input vide
                if (previousFilterState) {
                    // S'il y avait un filtre avant, il est supprimé
                    delete filters[tableId][key];
                    changed = true;
                } else {
                    if ($(currentElement).hasClass('filter-operator') && previousFilterState && previousFilterState.operator !== operatorValue) {
                        if (!filters[tableId][key]) {
                            filters[tableId][key] = {
                                value: '',
                                operator: operatorValue,
                                type: inputValueElement.getAttribute('data-type')
                            }
                        } else {
                            filters[tableId][key].operator = operatorValue;
                        }
                    }
                }
            }

            if (filters[tableId][key] !== undefined && filters[tableId][key].type === 'number') {
                const valueInput = String(filters[tableId][key].value ?? '').trim()
                const isValid = /^-?\d*(?:[.,]\d+)?$/.test(valueInput) || valueInput === ''

                if (!isValid) {
                    if (!alreadyAlerted) {
                        alreadyAlerted = true
                        alert('Valeur numérique invalide.');
                    }
                    return
                } else {
                    alreadyAlerted = false
                }
            }

            localStorage.setItem('filters', JSON.stringify(filters));

            /* Déclenche le timer SEULEMENT si un changement significatif (ajout/modification/suppression de filtre) a eu lieu.
            Un simple clic sur l'opérateur sans valeur ni changement d'opérateur ne déclenchera pas le draw. */
            if (changed) {
                const currentSettings = table.settings()[0];
                if (currentSettings && currentSettings.jqXHR) {
                    currentSettings.jqXHR.abort();
                }

                table.ajax.reload()

                initializeUrlDataTable(table);
                clearButtonAction(tableId)
            }
        }, 1000);
    });

    document.querySelectorAll('thead .dt-column-title').forEach(el => {
        const label = el.querySelector('label')
        const buttonOrder = document.createElement('span')
        buttonOrder.classList.add('sort-icon')
        el.insertBefore(buttonOrder, label.nextSibling)
    })

    // Réactiver le tri en excluant les filtres
    $(table.table().header()).off('click').on('click', 'th', function (event) {
        if (!event.target.classList.contains('filter-value') && !event.target.classList.contains('filter-operator')
            && event.target.tagName !== 'OPTION' && !this.classList.contains('dt-orderable-none')) {
            const columnIndex = $(this).index()
            let currentOrder = table.order()
            let nextOrder = 'asc' // Par défaut, le prochain ordre sera ascendant

            // Vérifie la structure de currentOrder pour détecter l'état actuel
            if (Array.isArray(currentOrder) && currentOrder.length > 0) {
                if (Array.isArray(currentOrder[0])) {
                    if (currentOrder[0][0] === columnIndex) {
                        nextOrder = currentOrder[0][1] === 'asc' ? 'desc' : null
                    }
                } else if (currentOrder.length === 2) {
                    if (currentOrder[0] === columnIndex) {
                        nextOrder = currentOrder[1] === 'asc' ? 'desc' : null
                    }
                }
            }

            if (nextOrder) {
                table.order([columnIndex, nextOrder]).draw()
            } else {
                table.order([]).draw()
            }
        }
    })
}

const initializeButtons = table => {
    const clearButton = document.getElementById('clearDataTable')
    if (clearButton) {
        clearButton.addEventListener('click', () => {
            const tableId = table.table().node().id
            if (filters[tableId]) delete filters[tableId]
            localStorage.setItem('filters', JSON.stringify(filters))
            document.querySelectorAll('thead .filter-value').forEach(el => el.value = '')
            document.querySelectorAll('thead .filter-operator').forEach(el => el.value = el.options[0].value)

            // Supprime le paramètre ajouté dans la requête (depuis les routes de suivi des suspensions et des échéances).
            initializeUrlDataTable(table)
            clearButtonAction(tableId)

            // Supprime les filtres actifs et Redéssine le datatable
            table.search('').columns().search('').draw()
        })
    }

    const dtButtonsContainer = document.querySelector('.dt-buttons')
    const targetContainer = document.querySelector('.dataTable-buttons')

    if (dtButtonsContainer && targetContainer) {
        targetContainer.prepend(dtButtonsContainer)
        dtButtonsContainer.classList.add('gap-2')
        dtButtonsContainer.querySelectorAll('button').forEach(el => el.classList.add('text-white'))
    }
}

function initializeNumDebFilterFromURL(table) {
    const url = new URL(window.location.href);
    let num = url.searchParams.get('numero_debiteur') || url.searchParams.get('numeroDebiteur');
    if (!num) return;

    num = num.replace(/\s+/g, '');
    const th = table.column('numeroDebiteur:name').header();
    const $input = $(th).find('input.filter-value');
    const $operator = $(th).find('select.filter-operator');

    if ($input.length) {
        $operator.val('starts_with');
        $input.val(num)
            .trigger('input')
            .trigger('keyup')
            .trigger('change');
    }

    table.ajax.reload();
}

const toggleVisibility = (parent, elementsToShow, elementsToHide) => {
    elementsToShow.forEach(selector => {
        parent.find(selector).removeClass('d-none')
    })
    elementsToHide.forEach(selector => {
        parent.find(selector).addClass('d-none')
    })
}

// Récupère les filtres actifs dans le localStorage.
const getFilters = dataTableName => {
    const filters = []
    const parseData = JSON.parse(localStorage.getItem("filters"))

    // Ajoute les filtres dans l'objet filters à transmettre dans le corps de la requête.
    if (parseData !== null && Object.keys(parseData).length > 0) {
        data = parseData[dataTableName]
        if (data) {
            Object.entries(data).forEach(([key, value]) => {
                const operator = value.operator
                const type = value.type
                filters.push({
                    columnName: key,
                    filterValue: value.value,
                    additionalCriteria: {operator: operator, type: type}
                })
            })
        }
    }
    return filters
}

const formatLocalDate = (number, region = 'fr-FR') => {
    const nf = new Intl.NumberFormat(region, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })
    return nf.format(number)
}

const parseFormattedNumber = (str) => {

    str = str.replace(" ", '')
        .replace(',', '.')

    return parseFloat(str)
}

// Récupère les soldes globaux et met à jour les totaux dans le pied de tableau
const getSoldes = async (callback, table, route, options, colIndex = null) => {
    if (colIndex !== null) {
        const footer = table.column(colIndex).footer()
        if (!footer) return

        // Extraction et conversion des valeurs
        const data = table.column(colIndex, {page: 'current'}).data()
        const total = Object.values(data)
            .map(valueRow => {
                if (typeof valueRow !== 'string') return 0
                return parseFloat(valueRow.replace(/\s|€/g, '').replace(',', '.')) || 0
            })
            .reduce((a, b) => a + b, 0)
            .toFixed(2)

        footer.innerHTML = new Intl.NumberFormat("fr-FR",
            {style: "currency", currency: "EUR"}).format(total)
    } else {
        try {
            /*
             * Si le status du XHR n'est pas UNSENT, on abort le call avant d'en faire un nouveau
             */
            if (getSoldesXMLHttpRequest.readyState !== XMLHttpRequest.UNSENT) {
                getSoldesXMLHttpRequest.abort();
            }

            /*
             * On ajoute une fonction qui s'exécute lorsque le status du XHR change
             */
            getSoldesXMLHttpRequest.onreadystatechange = () => {
                if (getSoldesXMLHttpRequest.readyState === XMLHttpRequest.DONE) {
                    if (getSoldesXMLHttpRequest.status !== 200) new Error(`Erreur lors de la récupération des soldes - Response: ${getSoldesXMLHttpRequest.responseText}`)
                    if (getSoldesXMLHttpRequest.response) callback(JSON.parse(getSoldesXMLHttpRequest.response))
                }
            };

            /*
             * Envoie de la requête XHR
             */
            getSoldesXMLHttpRequest.open('POST', route)
            getSoldesXMLHttpRequest.setRequestHeader('Content-Type', 'application/json');
            getSoldesXMLHttpRequest.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            getSoldesXMLHttpRequest.send(JSON.stringify({
                filters: getFilters(table.table().node().id),
                ...options
            }));
        } catch (error) {
            console.error("Erreur lors de la récupération des soldes :", error)
        }
    }
}

// Initialise les soldes et met à jour les totaux au changement de filtre ou tri
const initializeSoldes = (table, footers, route, options = {}, colIndex = null, devise = '') => {
    table.off('draw.dt order.dt')
    table.on('draw.dt order.dt', () => {
        Object.values(footers).forEach($el => $el.text('Calcul...'))

        getSoldes(
            soldes => Object.keys(footers).forEach(key => footers[key].text(soldes[key])),
            table, route, options, colIndex, devise
        )
    })
}

const initializeUrlDataTable = table => {
    // url datatable ajax
    const urlAjaxData = table.ajax.url()
    // url de la page courante
    let urlPage = new URL(window.location)
    // Efface tous les query params
    urlPage.search = ""
    // Met à jour l'URL sans recharger la page
    window.history.pushState({}, "", urlPage)
    // recharge la table avec un nouvel url (sans query params)
    table.ajax.url(urlAjaxData.split('?')[0])
}

// Cette fonction permet de plier/deplier les lignes d'un tableau
const collapseSubTable = (table, route, col = '', paramRoute = 'id') => {

    table.on('click', 'tbody td.dt-control', function () {
        let tr = $(this).closest('tr');
        let row = table.row(tr);

        if (row.child.isShown()) {
            row.child.hide();
        } else {
            $.ajax({
                url: Routing.generate(route, {[paramRoute]: row.data()[col]}),
                method: 'GET',
                dataType: 'json',
                success: (response) => {
                    row.child(response.html).show();
                    tr.next('tr').find('td').addClass('subtable-container').removeClass('dt-hover');
                }
            })
        }
    });
}

// Cette fonction permet au clic du numéro débiteur de l'insérer dans le filtre
const initializeClickableDebiteur = (table, columnName = 'numeroDebiteur') => {
    const tableId = table.table().node().id;

    $(document).on('click', `#${tableId} td.clickable-debiteur`, function () {
        const value = $(this).text().trim();
        const operator = $(`#${columnName}_operator`).val();
        const filtersCustom = JSON.parse(localStorage.getItem("filters")) || {};
        filtersCustom[tableId] = filtersCustom[tableId] || {};
        filtersCustom[tableId][columnName] = {
            value: value,
            operator: operator,
            type: 'numdeb'
        };

        filters = filtersCustom;
        localStorage.setItem("filters", JSON.stringify(filters));
        $(`#${columnName}`).val(value).trigger('input');

        table.ajax.reload();
        clearButtonAction(tableId)
    });
};

// Gestion de la visibilité du bouton "Réinitialiser les filtres".
const clearButtonAction = (tableId = null) => {
    // Récupérer l'élément du bouton "clearDataTable"
    const clearButton = document.getElementById('clearDataTable');
    if (!clearButton) return;

    // Trouver l'ID de la table, ou utiliser la première table par défaut
    tableId = tableId ?? document.querySelector('table')?.id;
    if (!tableId) return;

    // Basculer la visibilité du bouton
    clearButton.classList.toggle('d-none', !isFiltered(tableId));
};

// Vérifie si une table donnée a des filtres actifs.
const isFiltered = (tableId) => {
    // Vérifie si des filtres existent pour une table donnée
    const hasFilters = filters?.[tableId] && Object.keys(filters[tableId]).length > 0;
    return Boolean(hasFilters);
};
