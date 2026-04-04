window.addEventListener('DOMContentLoaded', function () {
    const userIsAdminOrRecouv = document.getElementById('role_admin_or_recouv').value === '1';

    let search_text = "";
    let data = [];
    let homeDataTable;
    const homeTable = $('#home-dataTable');

    if (!$.fn.DataTable.isDataTable('#home-dataTable')) {
        homeDataTable = homeTable.DataTable({
            data: data,
            rowId: 'id',
            serverSide: false,
            searching: false,
            ordering: false,
            footerCallback: function () {
                let api = this.api();

                let intVal = function (i) {
                    return typeof i === 'string'
                        ? parseFloat(i.replace(/[^0-9,-]+/g, '').replace(',', '.'))
                        : typeof i === 'number'
                            ? i
                            : 0;
                };

                const total = api
                    .column(3)
                    .data()
                    .reduce((a, b) => intVal(a) + intVal(b), 0)
                    .toFixed(2);

            api.column(3).footer().innerHTML =
                total + ' €';
        },
        columns: [
            {
                "data": "numeroCreance",
                "name": "numeroCreance",
            },
            {
                "data": "numeroReference",
                "name": "numeroReference",
                "render": function (data, type, row) {
                    if(data == null) return '';
                    const nameRoute = !userIsAdminOrRecouv ? 'creance_parcours_show' : 'creance_reference';
                    let id = row.id;
                    if (nameRoute === 'creance_reference') {
                        id = data;
                    }
                    return  `<a href="${ Routing.generate(nameRoute, {id: id})}">${data}</a>`
                }
            },
            {
                "data": "dateDetect",
                "name": "dateDetect"
            },
            {
                "data": "solde",
                "name": "solde",
                className: 'dt-body-right'
            },
            {
                "data": "motifsuspension",
                "name": "motifsuspension"
            },
            {
                "data": "numeroDebiteur",
                "name": "numeroDebiteur",
                "className": "clickable-debiteur"
            },
            {
                "data": "debiteur",
                "name": "debiteur",
            },
            {
                "data": "matriculeAssure",
                "name": "matriculeAssure"
            },
            {
                "data": "natureCompte",
                "name": "natureCompte"
            },
            {
                "data": "catDebiteur",
                "name": "catDebiteur"
            },
        ],
        initComplete: function () {
            const element = document.getElementById('home-dataTable')
            const parent = element.parentNode
            const wrapper = document.createElement('div')

                wrapper.classList.add('resize-wrapper');
                parent.replaceChild(wrapper, element);
                wrapper.appendChild(element);
            }
        });
    }


    $('#home-dataTable tfoot th, #home-dataTable tfoot td').css('border', 'none');

    // Lance la recherche avec la touche ENTRÉE du formulaire
    document.getElementById('my_search_form').addEventListener('submit', function (event) {
        event.preventDefault();
        searchFunction();
    });

    // Lance la recherche au clic sur le bouton Rechercher
    document.querySelector('button.smartsearch_btnsearch').addEventListener('click', function () {
        searchFunction();
    });

    // Réinitialise le tableau
    document.getElementById('clearDataTable').addEventListener('click', resetDataTable);

    // Recherche toutes les créances du débiteur au clic dans la colonne Numéro de débiteur
    $(document).on('click', 'td.clickable-debiteur', function () {
        document.getElementById('smartsearchinput').value = $(this).text();
        searchFunction();
    });

    window.addEventListener('DOMContentLoaded', searchOnClick);

    // Recherche au clic sur le bouton Rechercher
    function searchOnClick() {
        $(".smartsearch_btnsearch").click(searchFunction);
    }

    // Lance la recherche en base
    function searchFunction() {
        let smartSearchInput = $('#smartsearchinput');

        if (smartSearchInput.val() === '') {
            homeDataTable.clear().draw();
            alert('Saisissez l\'information à rechercher');
            smartSearchInput.focus();
            return;
        } else {
            const nb_caractere_mini = 3;
            if (smartSearchInput.val().length < nb_caractere_mini) {
                alert('Saisissez au-moins ' + nb_caractere_mini + ' caractères');
                smartSearchInput.focus();
                return;
            } else {
                homeDataTable.clear().draw();
            }
        }

        search_text = $("#smartsearchinput").val().toUpperCase();

        // Active l'indicateur de traitement
        homeDataTable.processing(true);

        $.ajax({
            type: "POST",
            url: Routing.generate('smartsearch'),
            data: {
                criteria: function () {
                    // Supprime les espaces d'une recherche par numéro avant de lancer la requête
                    let inputValue = $("#smartsearchinput").val().toUpperCase();
                    if (/^[0-9\s]*$/g.test(inputValue)) {
                        inputValue = inputValue.replace(/\s+/g, '');
                        return inputValue.toUpperCase();
                    }
                    return inputValue.toUpperCase();
                }
            },
            async: true,
            success: function (data) {
                if (data !== undefined
                    && data.data.length !== 0
                    && data.data[0]['userdata'] !== undefined
                    && data.data[0]['userdata']['type_recherche'] !== undefined
                    && data.data[0]['userdata']['type_recherche'] === 'par_nom') {

                    let inputValue = $("#smartsearchinput").val().toUpperCase().replace(/\s+/g, '_');
                    let resultList = $('#smartSearchResultList');
                    resultList.empty();

                    $.ajax({
                        type: "GET",
                        url: Routing.generate('by_name', {nom: inputValue}),
                        success: function(results) {
                            const resultList = $('#smartSearchResultList');
                            resultList.empty();

                            if (!results || results.length === 0) {
                                resultList.html(`
                                <li class="list-group-item text-center text-muted">
                                    Aucun résultat trouvé.
                                </li>
                            `);
                                document.getElementById('selected-item-label').textContent = '';
                                document.getElementById('confirm-selection').disabled = true;

                                const modal = new bootstrap.Modal(document.getElementById('smartSearchModal'));
                                modal.show();
                                homeDataTable.processing(false);
                                return;
                            }

                            const grouped = results.reduce((acc, item) => {
                                if (!acc[item.type]) acc[item.type] = [];
                                acc[item.type].push(item);
                                return acc;
                            }, {});

                            const searchTerm = $('#smartsearchinput').val().trim();
                            const regex = new RegExp(`(${searchTerm})`, 'gi');

                            for (const [type, items] of Object.entries(grouped)) {
                                resultList.append(`<li class="list-group-item list-group-item-secondary fw-bold">${type}</li>`);

                                items.forEach(item => {
                                    if (item.type && item.type === 'Erreur') {
                                        resultList.append(`<li class="list-group-item text-danger fw-bold">${item.nom}</li>`);
                                    } else {
                                        const nomSurligne = item.nom.replace(regex, '<mark class="p-0 m-0 bg-primary-subtle">$1</mark>');

                                        resultList.append(
                                            `<li class="list-group-item d-flex justify-content-between align-items-center">
                                            <div class="form-check w-100 d-flex align-items-center gap-3">
                                                <input class="form-check-input" type="radio" name="resultSelection" id="select-${item.id}" value="${item.id}" data-label="${item.nom}">
                                                <label class="form-check-label w-100" for="select-${item.id}">
                                                    <p class="mb-0 fw-bold">${nomSurligne} - ${item.id}</p> 
                                                    <p class="mb-0">${item.adresse}</p>
                                                </label>
                                            </div>
                                        </li>`
                                        );
                                    }
                                });
                            }

                            const modal = new bootstrap.Modal(document.getElementById('smartSearchModal'));
                            modal.show();
                            homeDataTable.processing(false);

                            document.getElementById('selected-item-label').textContent = '';
                            document.getElementById('confirm-selection').disabled = true;

                            resultList.on('change', 'input[name="resultSelection"]', function () {
                                const label = this.dataset.label;
                                document.getElementById('selected-item-label').textContent = 'Sélectionné : ' + label;
                                document.getElementById('confirm-selection').disabled = false;
                            });

                            document.getElementById('confirm-selection').onclick = function () {
                                const selectedRadio = document.querySelector('input[name="resultSelection"]:checked');
                                if (!selectedRadio) return;

                                const selectedId = selectedRadio.value;
                                $('#smartsearchinput').val(selectedId);
                                $('.smartsearch_btnsearch').click();

                                const modalInstance = bootstrap.Modal.getInstance(document.getElementById('smartSearchModal'));
                                modalInstance.hide();
                            };
                        }
                    });

                } else {
                    homeDataTable.clear().rows.add(data.data).draw();
                    homeDataTable.processing(false);
                }
            },
        });
    }

    function resetDataTable() {
        homeDataTable.clear().draw();
    }
});