window.addEventListener('DOMContentLoaded', function () {
    setupFormBehavior({
        elementsToShow: [],
        textInputSelector: 'input[type="text"]',
        excludedIds: []
    });

    const exportBtn = document.getElementById('btn-export-workflow');
    if (exportBtn) {
        exportBtn.addEventListener('click', function (e) {
            e.preventDefault();

            // Effet visuel de chargement
            const originalContent = exportBtn.innerHTML;
            exportBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Génération en cours...';
            exportBtn.classList.add('disabled');

            $.ajax({
                url: Routing.generate('workflow_complet_export'),
                method: "POST",
                data: JSON.stringify({
                    // On récupère les filtres appliqués à la table si getFilters existe
                    filters: typeof getFilters === 'function' ? getFilters('votre-id-datatable') : {}
                }),
                success: (response) => {
                    // Ajout du BOM UTF-8 pour le support des accents dans Excel
                    const BOM = new Uint8Array([0xEF, 0xBB, 0xBF]);
                    const blob = new Blob([BOM, response], { type: 'text/csv;charset=utf-8' });

                    const link = document.createElement('a');
                    link.href = window.URL.createObjectURL(blob);
                    link.download = 'export_workflows_complet_' + new Date().toLocaleDateString() + '.csv';

                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    window.URL.revokeObjectURL(link.href);
                },
                error: function () {
                    alert('Une erreur est survenue lors de l\'export des workflows.');
                },
                complete: function() {
                    exportBtn.innerHTML = originalContent;
                    exportBtn.classList.remove('disabled');
                }
            });
        });
    }

    // Sélection des éléments pour la case "Tout sélectionner" et les autres cases
    const selectAllCheckbox = document.querySelector('#seuils_delais_workflows_selectAll');
    const workflowCheckboxes = document.querySelectorAll('.input-container input[type="checkbox"]');

    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', function() {
            workflowCheckboxes.forEach(checkbox => {
                checkbox.checked = this.checked;
            });
        });

        workflowCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', function() {
                selectAllCheckbox.checked = Array.from(workflowCheckboxes).every(checkBox => checkBox.checked);
            });
        });
    }

    let inputSeuilsDelais = document.getElementsByClassName('inputSeuilsDelais');

    for (let input of inputSeuilsDelais) {
        if (input.type !== undefined) {
            input.addEventListener('input', () => {
                let linkedElement = input.id.includes('old') ?
                    document.getElementById(input.id.replace('old', 'new'))
                    : document.getElementById(input.id.replace('new', 'old'));

                if (input.value !== '' || linkedElement.value !== '') {
                    linkedElement.required = true;
                    input.required = true;
                } else {
                    linkedElement.required = false;
                    input.required = false;
                }
            });
        }
    }

    let form = document.getElementById('form_seuils_delais');
    form.addEventListener('submit', (e) => {
        e.preventDefault();

        let xmlHttpRequest = new XMLHttpRequest();

        /*
         * On ajoute une fonction qui s'exécute lorsque le status du XHR change
         */
        xmlHttpRequest.onreadystatechange = () => {
            if (xmlHttpRequest.readyState === XMLHttpRequest.DONE) {
                console.log(xmlHttpRequest);
                if (xmlHttpRequest.status === 400) {
                    alert(xmlHttpRequest.responseText);
                } else if (xmlHttpRequest.status === 200) {
                    form.submit();
                }
            }
        };

        /*
         * Gestion des valeurs dans le formulaire
         */
        let formData = new FormData(form);
        let jsonData = {};
        let listWfKey = 0;
        for (let data of formData) {
            if (data[0] === 'liste_wf[]') {
                data[0] = data[0].replace('[]', '[' + listWfKey + ']');
                listWfKey++;
            }

            jsonData[data[0]] = data[1];
        }

        /*
         * Envoie de la requête XHR
         */
        xmlHttpRequest.open('POST', Routing.generate('check_impacted_wfs'))
        xmlHttpRequest.setRequestHeader('Content-Type', 'application/json');
        xmlHttpRequest.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        xmlHttpRequest.send(JSON.stringify(jsonData));
    })
});