window.addEventListener('DOMContentLoaded', function () {
    function validateFormData(postdata, button, type = 'courrier') {
        addSpinner(button);
        let validations = [
            [postdata.description, 50, "L'intitulé ne doit pas être vide.", "Intitulé trop long."],
            [postdata.modele, 39, "Nom du modèle incorrect.", "Nom du modèle trop long."],
        ];

        if (type === 'sousMenu') {
            validations = [
                [postdata.nom, 50, null, "Nom du sous-menu trop long."],
            ];
        }

        for (const [value, maxLength, emptyError, lengthError] of validations) {
            let [isValid, message] = validateField(value, maxLength, emptyError, lengthError);
            if (!isValid) {
                alert(message);
                removeSpinner(button);
                return [false, message];
            }
        }

        if (type === 'courrier') {
            if (!/^([a-zA-Z0-9_]+)(.docx)$/.test(postdata.modele)) {
                alert("Nom du modèle invalide.");
                removeSpinner(button);
                return [false, "Nom du modèle invalide."];
            }
        }

        removeSpinner(button);
        return [true, ""];
    }

    function validateField(value, maxLength, emptyError, lengthError) {
        if (emptyError != null) {
            return (!value || !value.trim()) ? [false, emptyError]
                : (value.length > maxLength) ? [false, lengthError]
                    : [true, ""];
        }

        return (value.length > maxLength) ? [false, lengthError] : [true, ""];
    }

    // Ajout du spinner
    function addSpinner(element) {
        if (!element) {
            return;
        }
        if (!element.dataset.originalText) {
            element.dataset.originalText = element.textContent;
        }
        element.classList.add('btn-spin', 'disabled');
        element.disabled = true;
        element.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
        ${element.dataset.originalText}`;
    }

    // Suppression du spinner
    function removeSpinner(element = null) {
        const elements = element ? [element] : document.querySelectorAll('.btn-spin');

        elements.forEach(btn => {
            btn.classList.remove('btn-spin');
            btn.classList.remove('disabled');
            btn.disabled = false;
            btn.innerHTML = btn.dataset.originalText || btn.textContent;

            const spinners = btn.querySelectorAll('.spinner-border');
            spinners.forEach(spinner => spinner.remove());
        });
    }

    // Suppression backdrop
    function removeBackdrop() {
        let backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) {
            backdrop.remove();
            document.body.classList.remove('modal-open');
        }
    }

    /*
     * TABLE "Courriers Sucre"
     */
    const tableCourriersSucre = $('#list-saisie-couriers-sucre').DataTable({
        ajax: {
            url: Routing.generate('liste_courriers_sucre'),
            dataSrc: "data",
        },
        pageLength: 25,
        columns: [
            {
                data: "description",
                name: "description"
            },
            {
                data: "modele",
                name: "modele"
            },
            {
                data: "display",
                name: "display",
                orderable: false,
                render: function (data, type, row) {
                    const checked = data === true ? "checked" : "";
                    return `
                        <div class="text-center">
                            <input type="checkbox" data-id="${row.id}" ${checked}>
                        </div>`;
                }
            }
        ]
    });

    initializeFilters(tableCourriersSucre)

    tableCourriersSucre.on('change', 'input[type="checkbox"]', function () {
        const checkbox = $(this);
        const id = checkbox.data('id');
        const newValue = checkbox.is(':checked') ? true : false;

        $.ajax({
            url: Routing.generate('update_courrier_display'),
            method: 'POST',
            data: {
                id: id,
                display: newValue
            },
            success: function (response) {
                if (response.success) {
                    tableCourriersSucre.ajax.reload(null, false);
                }
            },
            error: function () {
                checkbox.prop('checked', !checkbox.is(':checked'));
            }
        });
    });

    /*
     * TABLE "Bibliothèque utilisateur"
     */
    const tableBibliothequeUser = $('#list-bibliotheque-utilisateur').DataTable({
        ajax: {
            url: Routing.generate('liste_courriers_specifiques'),
            dataSrc: "data",
        },
        pageLength: 25,
        select: {
            style: 'single'
        },
        columns: [
            {data: "sous_menu", name: "sous_menu"},
            {data: "description", name: "description"},
            {data: "modele", name: "modele"},
        ],
        footerCallback: function () {
            let api = this.api();
            api.column(0).footer().innerHTML = `
                <div class="d-flex align-items-center gap-3">
                    <button class="d-flex justify-content-center align-items-center add-courrier" title="Ajouter">
                        <i class="bi bi-plus-square text-white"></i>
                    </button>
                    <button class="d-flex justify-content-center align-items-center edit-courrier" title="Modifier">
                        <i class="bi bi-pen text-white"></i>
                    </button>
                    <button class="d-flex justify-content-center align-items-center delete-courrier btn-spin" title="Supprimer">
                        <i class="bi bi-trash text-white"></i>
                    </button>
                     <button class="d-flex justify-content-center align-items-center up-courrier d-none" data-direction="up" title="Monter">
                        <i class="bi bi-arrow-up-circle text-white"></i>
                    </button>
                     <button class="d-flex justify-content-center align-items-center down-courrier d-none" data-direction="down" title="Descendre">
                        <i class="bi bi-arrow-down-circle text-white"></i>
                    </button>
                </div>`;
        }
    });

    document.querySelector('#list-bibliotheque-utilisateur tbody').addEventListener('click', function (e) {
        let row = e.target.closest('tr');
        if (!row) return;

        if (row.rowIndex !== 1 && !row.firstChild.classList.contains('dt-empty')) {
            document.querySelectorAll('.up-courrier').forEach(btn => btn.classList.remove('d-none'))
        } else {
            document.querySelectorAll('.up-courrier').forEach(btn => btn.classList.add('d-none'))
        }

        if (row.rowIndex !== tableBibliothequeUser.rows().count() && !row.firstChild.classList.contains('dt-empty')) {
            document.querySelectorAll('.down-courrier').forEach(btn => btn.classList.remove('d-none'))
        } else {
            document.querySelectorAll('.down-courrier').forEach(btn => btn.classList.add('d-none'))
        }

        document.querySelectorAll('#list-bibliotheque-utilisateur tbody tr').forEach(tr => tr.classList.remove('selected'));
        row.classList.add('selected');
    });

    /*
     * MODALS DU TABLEAU "Bibliothèque utilisateur"
     */
    document.querySelector('#list-bibliotheque-utilisateur_wrapper').addEventListener('click', function (e) {
        const courrierModal = new bootstrap.Modal(document.getElementById('courrierModal'));
        const deleteModal = new bootstrap.Modal(document.getElementById('deleteModal'));
        let selectedRow = tableBibliothequeUser.row('.selected');
        let rowData = selectedRow.data();

        if (e.target.closest('.add-courrier')) {
            document.getElementById('courrierModalLabel').textContent = "Ajouter un courrier";
            document.getElementById('modal-action').value = 'add';
            document.getElementById('modal-sous-menu').value = '';
            document.getElementById('modal-description').value = '';
            document.getElementById('modal-modele').value = '';
            courrierModal.show();
        } else if (e.target.closest('.edit-courrier')) {
            if (!rowData) {
                alert("Veuillez sélectionner un modèle à modifier.");
                removeBackdrop();
                return;
            }
            document.getElementById('courrierModalLabel').textContent = "Modifier un courrier";
            document.getElementById('modal-action').value = 'edit';
            document.getElementById('modal-id').value = rowData.id;
            document.getElementById('modal-sous-menu').value = rowData.sous_menu;
            document.getElementById('modal-description').value = rowData.description;
            document.getElementById('modal-modele').value = rowData.modele;
            courrierModal.show();
        } else if (e.target.closest('.delete-courrier')) {
            if (!rowData) {
                alert("Veuillez sélectionner un modèle à supprimer.");
                return;
            }
            document.getElementById('delete-modal-body').textContent = `Voulez-vous vraiment supprimer le courrier "${rowData.description}" ?`;
            let confirmDelete = document.getElementById('confirm-delete');
            confirmDelete.dataset.route = 'edit_courriers_specifiques';
            confirmDelete.dataset.tableId = 'list-bibliotheque-utilisateur';
            deleteModal.show();
        } else if (e.target.closest('.up-courrier') || e.target.closest('.down-courrier')) {
            if (!rowData) {
                alert("Veuillez sélectionner un modèle à réordonner.");
                return;
            }

            e.target.closest('#list-bibliotheque-utilisateur_wrapper').querySelector('.dt-processing').style.display = 'block'

            fetch(Routing.generate('bibliotheque_reorder'), {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: new URLSearchParams({key: rowData.id, direction: e.target.closest('button').dataset.direction})
            })
                .then(() => {
                    tableBibliothequeUser.ajax.reload()
                })
                .catch(error => {
                    alert(error.message, 'Erreur', 'error')
                })
        }
    });

    /*
     * MODAL FORMULAIRE DU TABLEAU "Bibliothèque utilisateur"
     */
    document.getElementById('courrierForm').addEventListener('submit', function (e) {
        e.preventDefault();
        const spinnerButton = this.querySelector('button[type="submit"]');
        const sousMenu = document.getElementById('modal-sous-menu').value;
        const description = document.getElementById('modal-description').value;
        const modele = document.getElementById('modal-modele').value;
        const action = document.getElementById('modal-action').value;
        const id = document.getElementById('modal-id').value;

        if (validateFormData({sousMenu, description, modele}, spinnerButton)[0]) {
            addSpinner(spinnerButton);
            fetch(Routing.generate('edit_courriers_specifiques'), {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: new URLSearchParams({action: action, id: id, sousMenu, description, modele})
            })
                .then(response => {
                    if (!response.ok) {
                        return response.text().then(text => {
                            throw new Error(text);
                        });
                    }
                    return response.text();
                })
                .then(() => {
                    tableBibliothequeUser.ajax.reload();
                    bootstrap.Modal.getInstance(document.getElementById('courrierModal')).hide();
                    window.location.reload();
                })
                .catch(error => {
                    alert(error.message, 'Erreur', 'error');
                })
                .finally(() => {
                    removeSpinner(spinnerButton);
                });
        }
    });

    /*
     * TABLE "Sous-menus de la bibliothèque utilisateur"
     */
    const tableSousMenusBibliothequeUser = $('#list-sous-menus-bibiliotheque').DataTable({
        ajax: {
            url: Routing.generate('liste_sous_menus_bibliotheque'),
            dataSrc: "data",
        },
        pageLength: 25,
        select: {
            style: 'single'
        },
        columns: [
            {data: "nom", name: "nom"},
            {data: "numberOfCourrier", name: "numberOfCourrier"}
        ],
        footerCallback: function () {
            let api = this.api();
            api.column(0).footer().innerHTML = `
                <div class="d-flex align-items-center gap-3">
                    <button class="d-flex justify-content-center align-items-center add-sous-menu" title="Ajouter">
                        <i class="bi bi-plus-square text-white"></i>
                    </button>
                    <button class="d-flex justify-content-center align-items-center edit-sous-menu" title="Modifier">
                        <i class="bi bi-pen text-white"></i>
                    </button>
                    <button class="d-flex justify-content-center align-items-center delete-sous-menu btn-spin" title="Supprimer">
                        <i class="bi bi-trash text-white"></i>
                    </button>
                </div>`;
        }
    });

    document.querySelector('#list-sous-menus-bibiliotheque tbody').addEventListener('click', function (e) {
        let row = e.target.closest('tr');
        if (!row) return;

        document.querySelectorAll('#list-sous-menus-bibiliotheque tbody tr').forEach(tr => tr.classList.remove('selected'));
        row.classList.add('selected');
    });

    /*
     * MODALS DU TABLEAU "Sous-menus de la bibliothèque utilisateur"
     */
    document.querySelector('#list-sous-menus-bibiliotheque_wrapper').addEventListener('click', function (e) {
        const sousMenuModal = new bootstrap.Modal(document.getElementById('sousMenuModal'));
        const deleteModal = new bootstrap.Modal(document.getElementById('deleteModal'));
        let selectedRow = tableSousMenusBibliothequeUser.row('.selected');
        let rowData = selectedRow.data();

        if (e.target.closest('.add-sous-menu')) {
            document.getElementById('sousMenuModalLabel').textContent = "Ajouter un sous-menu";
            document.getElementById('modal-action').value = 'add';
            document.getElementById('modal-nom').value = '';
            sousMenuModal.show();
        } else if (e.target.closest('.edit-sous-menu')) {
            if (!rowData) {
                alert("Veuillez sélectionner un sous-menu à modifier.");
                removeBackdrop();
                return;
            }
            document.getElementById('sousMenuModalLabel').textContent = "Modifier un sous-menu";
            document.getElementById('modal-action').value = 'edit';
            document.getElementById('modal-id').value = rowData.id;
            document.getElementById('modal-nom').value = rowData.nom;
            sousMenuModal.show();
        } else if (e.target.closest('.delete-sous-menu')) {
            if (!rowData) {
                alert("Veuillez sélectionner un sous-menu à supprimer.");
                return;
            }
            document.getElementById('delete-modal-body').textContent = `Voulez-vous vraiment supprimer le sous-menu "${rowData.nom}" ?`;
            let confirmDelete = document.getElementById('confirm-delete');
            confirmDelete.dataset.route = 'edit_sous_menu_bibliotheque';
            confirmDelete.dataset.tableId = 'list-sous-menus-bibiliotheque';
            deleteModal.show();
        }
    });

    /*
     * MODAL FORMULAIRE DU TABLEAU "Sous-menus de la bibliothèque utilisateur"
     */
    document.getElementById('sousMenuForm').addEventListener('submit', function (e) {
        e.preventDefault();
        const spinnerButton = this.querySelector('button[type="submit"]');
        const nom = document.getElementById('modal-nom').value;
        const id = document.getElementById('modal-id').value;
        const action = document.getElementById('modal-action').value;

        if (validateFormData({nom}, spinnerButton, 'sousMenu')[0]) {
            addSpinner(spinnerButton);
            fetch(Routing.generate('edit_sous_menu_bibliotheque'), {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: new URLSearchParams({action: action, id: id, nom: nom})
            })
                .then(response => {
                    if (!response.ok) {
                        return response.text().then(text => {
                            throw new Error(text);
                        });
                    }
                    return response.text();
                })
                .then(() => {
                    window.location.reload();
                })
                .catch(error => {
                    alert(error.message, 'Erreur', 'error');
                })
                .finally(() => {
                    removeSpinner(spinnerButton);
                });
        }
    });

    // Confirmation suppression
    document.querySelector('#confirm-delete').addEventListener('click', function () {
        let button = this;
        addSpinner(button);
        let table = tableBibliothequeUser;

        if (this.dataset.tableId === 'list-sous-menus-bibiliotheque') {
            table = tableSousMenusBibliothequeUser;
        }

        let selectedRow = table.row('.selected');
        let rowData = selectedRow.data();

        fetch(Routing.generate(this.dataset.route), {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: new URLSearchParams({action: 'del', id: rowData.id})
        })
            .then(response => {
                if (!response.ok) {
                    return response.text().then(text => {
                        throw new Error(text);
                    });
                }
                return response.text();
            })
            .then(() => {
                window.location.reload();
            })
            .catch(error => {
                alert(error.message, 'Erreur', 'error');
            })
            .finally(() => removeSpinner(button));
    });

    document.querySelector('#list-saisie-couriers-sucre').addEventListener('change', function (e) {
        if (e.target.classList.contains('toggle-display')) {
            const checkbox = e.target;
            const id = checkbox.dataset.id;
            const newValue = checkbox.checked;
            fetch(Routing.generate('bibliotheque_masque_affiche'), {
                method: 'POST',
                body: new URLSearchParams({key: id, value: newValue})
            })
                .then(response => response.text())
                .then(() => tableCourriersSucre.ajax.reload());
        }
    });

    document.getElementById('courrierModal').addEventListener('hidden.bs.modal', function () {
        removeBackdrop();
    });
});